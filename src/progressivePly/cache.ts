import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProgressivePlyHeader, ProgressivePlyProperty } from './header';

export interface ProgressivePlyBuildOptions {
  previewPoints: number;
  tilePoints: number;
  lodSamplePoints: number;
  maxDepth: number;
  chunkBytes: number;
}

export const DEFAULT_PROGRESSIVE_BUILD_OPTIONS: ProgressivePlyBuildOptions = {
  previewPoints: 500_000,
  tilePoints: 200_000,
  lodSamplePoints: 50_000,
  maxDepth: 7,
  chunkBytes: 8 * 1024 * 1024,
};

export interface ProgressivePointPayload {
  positions: Float32Array;
  colors: Uint8Array | null;
  normals: Float32Array | null;
  intensity: Float32Array | null;
  scalarFields: Record<string, Float32Array>;
  count: number;
  sourceOrigin: [number, number, number];
}

export interface ProgressivePlyNode {
  id: string;
  level: number;
  bounds: [number, number, number, number, number, number];
  sourceCount: number;
  sampleCount: number;
  children: string[];
  leafPageCount: number;
}

export interface ProgressivePlyManifest {
  version: 1;
  source: {
    fileName: string;
    fileSize: number;
    mtime: number;
    vertexCount: number;
    format: 'binary_little_endian' | 'binary_big_endian';
    comments: string[];
  };
  sourceOrigin: [number, number, number];
  bounds: [number, number, number, number, number, number];
  depth: number;
  recordStride: number;
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  scalarFieldNames: string[];
  tilePoints: number;
  nodes: Record<string, ProgressivePlyNode>;
}

export interface ProgressivePlyPreviewResult {
  preview: ProgressivePointPayload;
  bounds: [number, number, number, number, number, number];
}

interface RecordLayout {
  stride: number;
  positionOffset: number;
  colorOffset: number;
  normalOffset: number;
  intensityOffset: number;
  scalarOffsets: Record<string, number>;
}

interface LeafState {
  id: string;
  filePath: string;
  count: number;
  buffer: Buffer | null;
  offset: number;
  writeChain: Promise<void>;
  lastUsed: number;
}

function scalarReader(
  buffer: Buffer,
  offset: number,
  property: ProgressivePlyProperty,
  littleEndian: boolean
): number {
  switch (property.type) {
    case 'int8': return buffer.readInt8(offset);
    case 'uint8': return buffer.readUInt8(offset);
    case 'int16': return littleEndian ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
    case 'uint16': return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 'int32': return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    case 'uint32': return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    case 'float32': return littleEndian ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset);
    case 'float64': return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
  }
}

function propertyMap(header: ProgressivePlyHeader): Map<string, ProgressivePlyProperty> {
  return new Map(header.properties.map(property => [property.name.toLowerCase(), property]));
}

function colorByte(value: number, property: ProgressivePlyProperty | undefined): number {
  if (!property || !Number.isFinite(value)) return 0;
  if (property.type === 'float32' || property.type === 'float64') {
    return Math.max(0, Math.min(255, Math.round(value <= 1 ? value * 255 : value)));
  }
  if (property.type === 'uint16') return Math.max(0, Math.min(255, Math.round(value / 257)));
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function* vertexChunks(
  filePath: string,
  header: ProgressivePlyHeader,
  chunkBytes: number
): AsyncGenerator<{ bytes: Buffer; startVertex: number }> {
  if (!header.vertexStride) throw new Error('Progressive PLY requires a fixed vertex stride');
  const stride = header.vertexStride;
  const handle = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.allocUnsafe(chunkBytes + stride);
  let carry = 0;
  let fileOffset = header.headerBytes;
  let vertexIndex = 0;
  try {
    while (vertexIndex < header.vertexCount) {
      const remainingFileBytes = (header.vertexCount - vertexIndex) * stride - carry;
      const toRead = Math.min(chunkBytes, Math.max(0, remainingFileBytes));
      const { bytesRead } = await handle.read(buffer, carry, toRead, fileOffset);
      if (bytesRead <= 0 && carry < stride) {
        throw new Error(
          `PLY vertex body is truncated at ${vertexIndex.toLocaleString()} / ${header.vertexCount.toLocaleString()} vertices`
        );
      }
      fileOffset += bytesRead;
      const total = carry + bytesRead;
      const completeRecords = Math.min(
        header.vertexCount - vertexIndex,
        Math.floor(total / stride)
      );
      const completeBytes = completeRecords * stride;
      if (completeBytes > 0) {
        yield { bytes: buffer.subarray(0, completeBytes), startVertex: vertexIndex };
        vertexIndex += completeRecords;
      }
      carry = total - completeBytes;
      if (carry > 0) buffer.copy(buffer, 0, completeBytes, total);
      if (bytesRead === 0 && carry === 0) break;
    }
  } finally {
    await handle.close();
  }
}

function readXYZ(
  bytes: Buffer,
  base: number,
  props: Map<string, ProgressivePlyProperty>,
  littleEndian: boolean
): [number, number, number] {
  const x = props.get('x')!;
  const y = props.get('y')!;
  const z = props.get('z')!;
  const xyz: [number, number, number] = [
    scalarReader(bytes, base + x.byteOffset, x, littleEndian),
    scalarReader(bytes, base + y.byteOffset, y, littleEndian),
    scalarReader(bytes, base + z.byteOffset, z, littleEndian),
  ];
  if (!xyz.every(Number.isFinite)) {
    throw new Error('PLY contains a non-finite x/y/z coordinate');
  }
  return xyz;
}

function optionalProperty(
  props: Map<string, ProgressivePlyProperty>,
  ...names: string[]
): ProgressivePlyProperty | undefined {
  for (const name of names) {
    const property = props.get(name);
    if (property) return property;
  }
  return undefined;
}

function createPayloadBuffers(
  count: number,
  header: ProgressivePlyHeader,
  sourceOrigin: [number, number, number]
): ProgressivePointPayload {
  const scalarFields: Record<string, Float32Array> = {};
  for (const name of header.scalarFieldNames) scalarFields[name] = new Float32Array(count);
  return {
    positions: new Float32Array(count * 3),
    colors: header.hasColors ? new Uint8Array(count * 3) : null,
    normals: header.hasNormals ? new Float32Array(count * 3) : null,
    intensity: header.hasIntensity ? new Float32Array(count) : null,
    scalarFields,
    count,
    sourceOrigin,
  };
}

function writeDecodedPoint(
  target: ProgressivePointPayload,
  targetIndex: number,
  bytes: Buffer,
  base: number,
  header: ProgressivePlyHeader,
  props: Map<string, ProgressivePlyProperty>
): void {
  const xyz = readXYZ(bytes, base, props, header.littleEndian);
  target.positions[targetIndex * 3] = xyz[0] - target.sourceOrigin[0];
  target.positions[targetIndex * 3 + 1] = xyz[1] - target.sourceOrigin[1];
  target.positions[targetIndex * 3 + 2] = xyz[2] - target.sourceOrigin[2];

  if (target.colors) {
    const red = optionalProperty(props, 'red', 'r');
    const green = optionalProperty(props, 'green', 'g');
    const blue = optionalProperty(props, 'blue', 'b');
    target.colors[targetIndex * 3] = colorByte(
      red ? scalarReader(bytes, base + red.byteOffset, red, header.littleEndian) : 0,
      red
    );
    target.colors[targetIndex * 3 + 1] = colorByte(
      green ? scalarReader(bytes, base + green.byteOffset, green, header.littleEndian) : 0,
      green
    );
    target.colors[targetIndex * 3 + 2] = colorByte(
      blue ? scalarReader(bytes, base + blue.byteOffset, blue, header.littleEndian) : 0,
      blue
    );
  }
  if (target.normals) {
    for (const [axis, name] of ['nx', 'ny', 'nz'].entries()) {
      const property = props.get(name)!;
      target.normals[targetIndex * 3 + axis] = scalarReader(
        bytes,
        base + property.byteOffset,
        property,
        header.littleEndian
      );
    }
  }
  if (target.intensity) {
    const property = props.get('intensity')!;
    target.intensity[targetIndex] = scalarReader(
      bytes,
      base + property.byteOffset,
      property,
      header.littleEndian
    );
  }
  for (const name of header.scalarFieldNames) {
    const property = props.get(name.toLowerCase());
    if (property) {
      target.scalarFields[name][targetIndex] = scalarReader(
        bytes,
        base + property.byteOffset,
        property,
        header.littleEndian
      );
    }
  }
}

export async function buildProgressivePreview(
  filePath: string,
  header: ProgressivePlyHeader,
  options: ProgressivePlyBuildOptions = DEFAULT_PROGRESSIVE_BUILD_OPTIONS,
  onProgress?: (fraction: number) => void,
  onEarlyPreview?: (preview: ProgressivePointPayload) => Promise<void> | void,
  isCancelled?: () => boolean
): Promise<ProgressivePlyPreviewResult> {
  if (!header.vertexStride) throw new Error('Progressive PLY requires a fixed vertex stride');
  const props = propertyMap(header);
  const sampleStep = Math.max(1, Math.ceil(header.vertexCount / Math.max(1, options.previewPoints)));
  const expectedSamples = Math.min(header.vertexCount, Math.ceil(header.vertexCount / sampleStep));
  let sourceOrigin: [number, number, number] | null = null;
  const rawPositions = new Float64Array(expectedSamples * 3);
  const payload = createPayloadBuffers(expectedSamples, header, [0, 0, 0]);
  const bounds: [number, number, number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let sampleIndex = 0;
  let scanned = 0;
  let earlySent = false;

  for await (const chunk of vertexChunks(filePath, header, options.chunkBytes)) {
    if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
    const records = chunk.bytes.length / header.vertexStride;
    for (let local = 0; local < records; local++) {
      const sourceIndex = chunk.startVertex + local;
      const base = local * header.vertexStride;
      const xyz = readXYZ(chunk.bytes, base, props, header.littleEndian);
      if (!sourceOrigin) sourceOrigin = [xyz[0], xyz[1], xyz[2]];
      bounds[0] = Math.min(bounds[0], xyz[0]);
      bounds[1] = Math.min(bounds[1], xyz[1]);
      bounds[2] = Math.min(bounds[2], xyz[2]);
      bounds[3] = Math.max(bounds[3], xyz[0]);
      bounds[4] = Math.max(bounds[4], xyz[1]);
      bounds[5] = Math.max(bounds[5], xyz[2]);
      if (sourceIndex % sampleStep === 0 && sampleIndex < expectedSamples) {
        rawPositions[sampleIndex * 3] = xyz[0];
        rawPositions[sampleIndex * 3 + 1] = xyz[1];
        rawPositions[sampleIndex * 3 + 2] = xyz[2];
        writeDecodedPoint(payload, sampleIndex, chunk.bytes, base, header, props);
        sampleIndex++;
      }
    }
    scanned += records;
    onProgress?.(Math.min(1, scanned / header.vertexCount));
    // Yield between bounded chunks so the remote extension host can still
    // process cancellation and other VS Code events during a multi-GB scan.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (
      !earlySent &&
      onEarlyPreview &&
      sourceOrigin &&
      sampleIndex >= Math.min(20_000, Math.max(2_000, Math.floor(expectedSamples / 10)))
    ) {
      payload.sourceOrigin = sourceOrigin;
      for (let i = 0; i < sampleIndex; i++) {
        payload.positions[i * 3] = rawPositions[i * 3] - sourceOrigin[0];
        payload.positions[i * 3 + 1] = rawPositions[i * 3 + 1] - sourceOrigin[1];
        payload.positions[i * 3 + 2] = rawPositions[i * 3 + 2] - sourceOrigin[2];
      }
      await onEarlyPreview(slicePayload(payload, sampleIndex));
      earlySent = true;
    }
  }

  if (!sourceOrigin) sourceOrigin = [0, 0, 0];
  payload.sourceOrigin = sourceOrigin;
  for (let i = 0; i < sampleIndex; i++) {
    payload.positions[i * 3] = rawPositions[i * 3] - sourceOrigin[0];
    payload.positions[i * 3 + 1] = rawPositions[i * 3 + 1] - sourceOrigin[1];
    payload.positions[i * 3 + 2] = rawPositions[i * 3 + 2] - sourceOrigin[2];
  }
  return { preview: slicePayload(payload, sampleIndex), bounds };
}

function slicePayload(payload: ProgressivePointPayload, count: number): ProgressivePointPayload {
  const scalarFields: Record<string, Float32Array> = {};
  for (const [name, values] of Object.entries(payload.scalarFields)) {
    scalarFields[name] = values.slice(0, count);
  }
  return {
    positions: payload.positions.slice(0, count * 3),
    colors: payload.colors?.slice(0, count * 3) ?? null,
    normals: payload.normals?.slice(0, count * 3) ?? null,
    intensity: payload.intensity?.slice(0, count) ?? null,
    scalarFields,
    count,
    sourceOrigin: payload.sourceOrigin,
  };
}

function createRecordLayout(header: ProgressivePlyHeader): RecordLayout {
  let stride = 12;
  const colorOffset = header.hasColors ? stride : -1;
  if (header.hasColors) stride += 3;
  const normalOffset = header.hasNormals ? stride : -1;
  if (header.hasNormals) stride += 12;
  const intensityOffset = header.hasIntensity ? stride : -1;
  if (header.hasIntensity) stride += 4;
  const scalarOffsets: Record<string, number> = {};
  for (const name of header.scalarFieldNames) {
    scalarOffsets[name] = stride;
    stride += 4;
  }
  return { stride, positionOffset: 0, colorOffset, normalOffset, intensityOffset, scalarOffsets };
}

function octreePath(
  x: number,
  y: number,
  z: number,
  bounds: [number, number, number, number, number, number],
  depth: number
): string {
  let [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  let id = '';
  for (let level = 0; level < depth; level++) {
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;
    const bx = x >= midX ? 1 : 0;
    const by = y >= midY ? 1 : 0;
    const bz = z >= midZ ? 1 : 0;
    const octant = bx | (by << 1) | (bz << 2);
    id += String(octant);
    if (bx) minX = midX; else maxX = midX;
    if (by) minY = midY; else maxY = midY;
    if (bz) minZ = midZ; else maxZ = midZ;
  }
  return id;
}

function nodeBounds(
  id: string,
  bounds: [number, number, number, number, number, number],
  origin: [number, number, number]
): [number, number, number, number, number, number] {
  let [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  for (const digit of id) {
    const octant = Number(digit);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;
    if (octant & 1) minX = midX; else maxX = midX;
    if (octant & 2) minY = midY; else maxY = midY;
    if (octant & 4) minZ = midZ; else maxZ = midZ;
  }
  return [
    minX - origin[0], minY - origin[1], minZ - origin[2],
    maxX - origin[0], maxY - origin[1], maxZ - origin[2],
  ];
}

class LeafSpooler {
  private states = new Map<string, LeafState>();
  private pendingBytes = 0;
  private activeBuffers = 0;
  private useCounter = 0;

  constructor(
    private readonly directory: string,
    private readonly recordStride: number,
    // 8 KiB × 8192 active leaves caps the spool buffer pool at 64 MiB while
    // allowing a typical ~1 GB cloud (depth-4 octree, <=4096 leaves) to avoid
    // LRU churn even when acquisition order is spatially interleaved.
    private readonly bufferBytes = 8 * 1024,
    private readonly maxActiveBuffers = 8192
  ) {}

  state(id: string): LeafState {
    let state = this.states.get(id);
    if (!state) {
      state = {
        id,
        filePath: path.join(this.directory, `${id || 'root'}.bin`),
        count: 0,
        buffer: null,
        offset: 0,
        writeChain: Promise.resolve(),
        lastUsed: 0,
      };
      this.states.set(id, state);
    }
    return state;
  }

  private ensureBuffer(state: LeafState): Buffer {
    state.lastUsed = ++this.useCounter;
    if (state.buffer) return state.buffer;

    if (this.activeBuffers >= this.maxActiveBuffers) {
      let victim: LeafState | undefined;
      for (const candidate of this.states.values()) {
        if (
          candidate.buffer &&
          candidate !== state &&
          (!victim || candidate.lastUsed < victim.lastUsed)
        ) {
          victim = candidate;
        }
      }
      if (victim) this.queueFlush(victim, true);
    }

    state.buffer = Buffer.allocUnsafe(Math.max(this.bufferBytes, this.recordStride * 4));
    this.activeBuffers++;
    return state.buffer;
  }

  /**
   * Hot-path append is intentionally synchronous. Awaiting one Promise per
   * point made a 1 GB cloud create tens of millions of microtasks. Only a
   * bounded LRU set of leaf buffers is resident; evicted buffers are flushed
   * through per-leaf write chains.
   */
  append(id: string, writer: (buffer: Buffer, offset: number) => void): void {
    const state = this.state(id);
    let buffer = this.ensureBuffer(state);
    if (state.offset + this.recordStride > buffer.length) {
      this.queueFlush(state, false);
      buffer = this.ensureBuffer(state);
    }
    writer(buffer, state.offset);
    state.offset += this.recordStride;
    state.count++;
  }

  private queueFlush(state: LeafState, releaseBuffer: boolean): void {
    const buffer = state.buffer;
    if (!buffer) return;

    if (state.offset > 0) {
      const chunk = Buffer.from(buffer.subarray(0, state.offset));
      state.offset = 0;
      this.pendingBytes += chunk.byteLength;
      state.writeChain = state.writeChain
        .then(() => fs.promises.appendFile(state.filePath, chunk))
        .finally(() => {
          this.pendingBytes -= chunk.byteLength;
        });
    }

    if (releaseBuffer) {
      state.buffer = null;
      this.activeBuffers = Math.max(0, this.activeBuffers - 1);
    }
  }

  async drainIfNeeded(limitBytes = 32 * 1024 * 1024): Promise<void> {
    if (this.pendingBytes <= limitBytes) return;
    await Promise.all([...this.states.values()].map(state => state.writeChain));
  }

  async finish(): Promise<Map<string, LeafState>> {
    for (const state of this.states.values()) this.queueFlush(state, true);
    await Promise.all([...this.states.values()].map(state => state.writeChain));
    return this.states;
  }
}

function writeCacheRecord(
  buffer: Buffer,
  offset: number,
  bytes: Buffer,
  base: number,
  header: ProgressivePlyHeader,
  props: Map<string, ProgressivePlyProperty>,
  layout: RecordLayout,
  sourceOrigin: [number, number, number]
): void {
  const xyz = readXYZ(bytes, base, props, header.littleEndian);
  buffer.writeFloatLE(xyz[0] - sourceOrigin[0], offset + layout.positionOffset);
  buffer.writeFloatLE(xyz[1] - sourceOrigin[1], offset + layout.positionOffset + 4);
  buffer.writeFloatLE(xyz[2] - sourceOrigin[2], offset + layout.positionOffset + 8);
  if (layout.colorOffset >= 0) {
    const red = optionalProperty(props, 'red', 'r');
    const green = optionalProperty(props, 'green', 'g');
    const blue = optionalProperty(props, 'blue', 'b');
    buffer[offset + layout.colorOffset] = colorByte(
      red ? scalarReader(bytes, base + red.byteOffset, red, header.littleEndian) : 0,
      red
    );
    buffer[offset + layout.colorOffset + 1] = colorByte(
      green ? scalarReader(bytes, base + green.byteOffset, green, header.littleEndian) : 0,
      green
    );
    buffer[offset + layout.colorOffset + 2] = colorByte(
      blue ? scalarReader(bytes, base + blue.byteOffset, blue, header.littleEndian) : 0,
      blue
    );
  }
  if (layout.normalOffset >= 0) {
    for (const [axis, name] of ['nx', 'ny', 'nz'].entries()) {
      const property = props.get(name)!;
      buffer.writeFloatLE(
        scalarReader(bytes, base + property.byteOffset, property, header.littleEndian),
        offset + layout.normalOffset + axis * 4
      );
    }
  }
  if (layout.intensityOffset >= 0) {
    const property = props.get('intensity')!;
    buffer.writeFloatLE(
      scalarReader(bytes, base + property.byteOffset, property, header.littleEndian),
      offset + layout.intensityOffset
    );
  }
  for (const name of header.scalarFieldNames) {
    const property = props.get(name.toLowerCase());
    if (property) {
      buffer.writeFloatLE(
        scalarReader(bytes, base + property.byteOffset, property, header.littleEndian),
        offset + layout.scalarOffsets[name]
      );
    }
  }
}

async function sampleRecordFile(
  source: string,
  destination: string,
  recordStride: number,
  recordCount: number,
  maxSamples: number,
  isCancelled?: () => boolean
): Promise<number> {
  if (recordCount <= 0) {
    await fs.promises.writeFile(destination, Buffer.alloc(0));
    return 0;
  }
  const step = Math.max(1, Math.ceil(recordCount / maxSamples));
  const sourceHandle = await fs.promises.open(source, 'r');
  const chunkRecords = Math.min(8192, recordCount);
  const buffer = Buffer.allocUnsafe(chunkRecords * recordStride);
  const output = Buffer.allocUnsafe(Math.min(recordCount, maxSamples) * recordStride);
  let sourceIndex = 0;
  let written = 0;
  try {
    while (sourceIndex < recordCount && written < maxSamples) {
      if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
      const requested = Math.min(chunkRecords, recordCount - sourceIndex);
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        requested * recordStride,
        sourceIndex * recordStride
      );
      const got = Math.floor(bytesRead / recordStride);
      if (got <= 0) break;
      for (let local = 0; local < got && written < maxSamples; local++) {
        const absolute = sourceIndex + local;
        if (absolute % step === 0) {
          buffer.copy(
            output,
            written * recordStride,
            local * recordStride,
            (local + 1) * recordStride
          );
          written++;
        }
      }
      sourceIndex += got;
    }
  } finally {
    await sourceHandle.close();
  }
  await fs.promises.writeFile(destination, output.subarray(0, written * recordStride));
  return written;
}

async function mergeSampleFiles(
  sources: Array<{ file: string; count: number }>,
  destination: string,
  recordStride: number,
  maxSamples: number,
  isCancelled?: () => boolean
): Promise<number> {
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  if (total === 0) {
    await fs.promises.writeFile(destination, Buffer.alloc(0));
    return 0;
  }
  const step = Math.max(1, Math.ceil(total / maxSamples));
  const output = Buffer.allocUnsafe(Math.min(total, maxSamples) * recordStride);
  let globalIndex = 0;
  let written = 0;
  for (const source of sources) {
    if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
    if (written >= maxSamples) break;
    const handle = await fs.promises.open(source.file, 'r');
    const buffer = Buffer.allocUnsafe(recordStride * Math.min(4096, Math.max(1, source.count)));
    try {
      let sourceIndex = 0;
      while (sourceIndex < source.count && written < maxSamples) {
        if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
        const records = Math.min(
          Math.floor(buffer.length / recordStride),
          source.count - sourceIndex
        );
        const { bytesRead } = await handle.read(
          buffer,
          0,
          records * recordStride,
          sourceIndex * recordStride
        );
        const got = Math.floor(bytesRead / recordStride);
        if (got === 0) break;
        for (let i = 0; i < got && written < maxSamples; i++, globalIndex++) {
          if (globalIndex % step === 0) {
            buffer.copy(
              output,
              written * recordStride,
              i * recordStride,
              (i + 1) * recordStride
            );
            written++;
          }
        }
        sourceIndex += got;
      }
    } finally {
      await handle.close();
    }
  }
  await fs.promises.writeFile(destination, output.subarray(0, written * recordStride));
  return written;
}

export function progressiveCacheKey(
  filePath: string,
  fileSize: number,
  mtime: number,
  headerBytes: Uint8Array
): string {
  return crypto
    .createHash('sha1')
    .update(filePath)
    .update(String(fileSize))
    .update(String(mtime))
    .update(headerBytes)
    .digest('hex');
}

export async function loadProgressiveManifest(
  cacheDirectory: string
): Promise<ProgressivePlyManifest | null> {
  try {
    return JSON.parse(
      await fs.promises.readFile(path.join(cacheDirectory, 'manifest.json'), 'utf8')
    ) as ProgressivePlyManifest;
  } catch {
    return null;
  }
}

export async function buildProgressiveCache(
  filePath: string,
  cacheDirectory: string,
  header: ProgressivePlyHeader,
  stat: { size: number; mtime: number },
  previewResult: ProgressivePlyPreviewResult,
  options: ProgressivePlyBuildOptions = DEFAULT_PROGRESSIVE_BUILD_OPTIONS,
  onProgress?: (phase: string, fraction: number) => void,
  isCancelled?: () => boolean
): Promise<ProgressivePlyManifest> {
  if (!header.vertexStride) throw new Error('Progressive PLY requires fixed-width vertices');
  const depth = Math.max(
    1,
    Math.min(
      options.maxDepth,
      Math.ceil(Math.log(Math.max(1, header.vertexCount / options.tilePoints)) / Math.log(8)) + 1
    )
  );
  const tempDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`;
  const leavesDirectory = path.join(tempDirectory, 'leaves');
  const lodDirectory = path.join(tempDirectory, 'lod');
  await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  await fs.promises.mkdir(leavesDirectory, { recursive: true });
  await fs.promises.mkdir(lodDirectory, { recursive: true });

  let cachePublished = false;
  try {
    const layout = createRecordLayout(header);
    const props = propertyMap(header);
    const spooler = new LeafSpooler(leavesDirectory, layout.stride);
    let processed = 0;

  for await (const chunk of vertexChunks(filePath, header, options.chunkBytes)) {
    if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
    const records = chunk.bytes.length / header.vertexStride;
    for (let local = 0; local < records; local++) {
      const base = local * header.vertexStride;
      const xyz = readXYZ(chunk.bytes, base, props, header.littleEndian);
      const id = octreePath(xyz[0], xyz[1], xyz[2], previewResult.bounds, depth);
      spooler.append(id, (target, targetOffset) =>
        writeCacheRecord(
          target,
          targetOffset,
          chunk.bytes,
          base,
          header,
          props,
          layout,
          previewResult.preview.sourceOrigin
        )
      );
    }
    processed += records;
    onProgress?.('index', Math.min(1, processed / header.vertexCount));
    await spooler.drainIfNeeded();
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  const leaves = await spooler.finish();
  const nodes = new Map<string, ProgressivePlyNode & { sampleFile?: string }>();
  const ensureNode = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        level: id.length,
        bounds: nodeBounds(id, previewResult.bounds, previewResult.preview.sourceOrigin),
        sourceCount: 0,
        sampleCount: 0,
        children: [],
        leafPageCount: 0,
      };
      nodes.set(id, node);
    }
    return node;
  };
  ensureNode('');

  let leafDone = 0;
  for (const [id, state] of leaves) {
    if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
    const leaf = ensureNode(id);
    leaf.sourceCount = state.count;
    leaf.leafPageCount = Math.ceil(state.count / options.tilePoints);
    let childId = id;
    for (let level = id.length - 1; level >= 0; level--) {
      const parentId = id.slice(0, level);
      const parent = ensureNode(parentId);
      if (!parent.children.includes(childId)) parent.children.push(childId);
      parent.sourceCount += state.count;
      childId = parentId;
    }
    const samplePath = path.join(lodDirectory, `${id || 'root'}.bin`);
    leaf.sampleCount = await sampleRecordFile(
      state.filePath,
      samplePath,
      layout.stride,
      state.count,
      options.lodSamplePoints,
      isCancelled
    );
    leaf.sampleFile = samplePath;
    leafDone++;
    onProgress?.('lod', leafDone / Math.max(1, leaves.size + nodes.size));
  }

  for (let level = depth - 1; level >= 0; level--) {
    const levelNodes = [...nodes.values()].filter(node => node.level === level);
    for (const node of levelNodes) {
      if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
      const children = node.children
        .map(id => nodes.get(id))
        .filter((child): child is ProgressivePlyNode & { sampleFile?: string } => !!child);
      const sources = children
        .filter(child => !!child.sampleFile)
        .map(child => ({ file: child.sampleFile!, count: child.sampleCount }));
      const samplePath = path.join(lodDirectory, `${node.id || 'root'}.bin`);
      node.sampleCount = await mergeSampleFiles(
        sources,
        samplePath,
        layout.stride,
        options.lodSamplePoints,
        isCancelled
      );
      node.sampleFile = samplePath;
    }
  }

  if (isCancelled?.()) throw new Error('Progressive PLY load cancelled');
  const finalStat = await fs.promises.stat(filePath);
  if (
    finalStat.size !== stat.size ||
    Math.abs(finalStat.mtimeMs - stat.mtime) > 1
  ) {
    throw new Error('Source PLY changed while progressive cache was being built');
  }

  const manifest: ProgressivePlyManifest = {
    version: 1,
    source: {
      fileName: path.basename(filePath),
      fileSize: stat.size,
      mtime: stat.mtime,
      vertexCount: header.vertexCount,
      format: header.format as 'binary_little_endian' | 'binary_big_endian',
      comments: header.comments,
    },
    sourceOrigin: previewResult.preview.sourceOrigin,
    bounds: nodeBounds('', previewResult.bounds, previewResult.preview.sourceOrigin),
    depth,
    recordStride: layout.stride,
    hasColors: header.hasColors,
    hasNormals: header.hasNormals,
    hasIntensity: header.hasIntensity,
    scalarFieldNames: header.scalarFieldNames,
    tilePoints: options.tilePoints,
    nodes: Object.fromEntries(
      [...nodes.entries()].map(([id, node]) => [
        id,
        {
          id: node.id,
          level: node.level,
          bounds: node.bounds,
          sourceCount: node.sourceCount,
          sampleCount: node.sampleCount,
          children: node.children.sort(),
          leafPageCount: node.leafPageCount,
        },
      ])
    ),
  };

  await fs.promises.writeFile(
    path.join(tempDirectory, 'manifest.json'),
    JSON.stringify(manifest)
  );
  await fs.promises.rm(cacheDirectory, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(cacheDirectory), { recursive: true });
    await fs.promises.rename(tempDirectory, cacheDirectory);
    cachePublished = true;
    onProgress?.('complete', 1);
    return manifest;
  } finally {
    if (!cachePublished) {
      await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function decodeCacheRecords(
  bytes: Buffer,
  manifest: ProgressivePlyManifest
): ProgressivePointPayload {
  const count = Math.floor(bytes.length / manifest.recordStride);
  const headerLike = {
    hasColors: manifest.hasColors,
    hasNormals: manifest.hasNormals,
    hasIntensity: manifest.hasIntensity,
    scalarFieldNames: manifest.scalarFieldNames,
  } as ProgressivePlyHeader;
  const payload = createPayloadBuffers(count, headerLike, manifest.sourceOrigin);
  const layout = createRecordLayout(headerLike);
  for (let i = 0; i < count; i++) {
    const base = i * manifest.recordStride;
    payload.positions[i * 3] = bytes.readFloatLE(base);
    payload.positions[i * 3 + 1] = bytes.readFloatLE(base + 4);
    payload.positions[i * 3 + 2] = bytes.readFloatLE(base + 8);
    if (payload.colors && layout.colorOffset >= 0) {
      payload.colors[i * 3] = bytes[base + layout.colorOffset];
      payload.colors[i * 3 + 1] = bytes[base + layout.colorOffset + 1];
      payload.colors[i * 3 + 2] = bytes[base + layout.colorOffset + 2];
    }
    if (payload.normals && layout.normalOffset >= 0) {
      payload.normals[i * 3] = bytes.readFloatLE(base + layout.normalOffset);
      payload.normals[i * 3 + 1] = bytes.readFloatLE(base + layout.normalOffset + 4);
      payload.normals[i * 3 + 2] = bytes.readFloatLE(base + layout.normalOffset + 8);
    }
    if (payload.intensity && layout.intensityOffset >= 0) {
      payload.intensity[i] = bytes.readFloatLE(base + layout.intensityOffset);
    }
    for (const name of manifest.scalarFieldNames) {
      payload.scalarFields[name][i] = bytes.readFloatLE(base + layout.scalarOffsets[name]);
    }
  }
  return payload;
}

export async function readProgressiveTile(
  cacheDirectory: string,
  manifest: ProgressivePlyManifest,
  tileId: string
): Promise<ProgressivePointPayload> {
  if (tileId.startsWith('node:')) {
    const nodeId = tileId.slice('node:'.length);
    if (!/^[0-7]*$/.test(nodeId) || !manifest.nodes[nodeId]) {
      throw new Error(`Unknown progressive PLY node tile ${tileId}`);
    }
    const fileName = `${nodeId || 'root'}.bin`;
    return decodeCacheRecords(
      await fs.promises.readFile(path.join(cacheDirectory, 'lod', fileName)),
      manifest
    );
  }
  if (tileId.startsWith('leaf:')) {
    const [, nodeId, pageText] = tileId.split(':');
    const node = manifest.nodes[nodeId];
    if (!/^[0-7]+$/.test(nodeId) || !node || node.leafPageCount <= 0) {
      throw new Error(`Unknown leaf tile ${tileId}`);
    }
    const page = Number(pageText);
    if (!Number.isInteger(page) || page < 0 || page >= node.leafPageCount) {
      throw new Error(`Invalid leaf page ${tileId}`);
    }
    const startRecord = page * manifest.tilePoints;
    const count = Math.min(manifest.tilePoints, node.sourceCount - startRecord);
    const handle = await fs.promises.open(path.join(cacheDirectory, 'leaves', `${nodeId}.bin`), 'r');
    try {
      const bytes = Buffer.allocUnsafe(count * manifest.recordStride);
      const result = await handle.read(
        bytes,
        0,
        bytes.length,
        startRecord * manifest.recordStride
      );
      return decodeCacheRecords(bytes.subarray(0, result.bytesRead), manifest);
    } finally {
      await handle.close();
    }
  }
  throw new Error(`Unsupported progressive PLY tile id: ${tileId}`);
}
