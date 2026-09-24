import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';

export type ProgressivePlyEncoding =
  | 'ascii'
  | 'binary_little_endian'
  | 'binary_big_endian';

type ScalarType =
  | 'char'
  | 'uchar'
  | 'int8'
  | 'uint8'
  | 'short'
  | 'ushort'
  | 'int16'
  | 'uint16'
  | 'int'
  | 'uint'
  | 'int32'
  | 'uint32'
  | 'float'
  | 'float32'
  | 'double'
  | 'float64';

export interface ProgressivePlyProperty {
  name: string;
  type: ScalarType;
  offset: number;
  size: number;
}

export interface ProgressivePlyProbe {
  encoding: ProgressivePlyEncoding;
  headerBytes: number;
  headerHash: string;
  vertexCount: number;
  faceCount: number;
  vertexStride: number;
  properties: ProgressivePlyProperty[];
  scalarNames: string[];
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  isGaussianSplat: boolean;
  comments: string[];
}

export interface ProgressivePlyDecisionOptions {
  enabled: boolean;
  fileSizeThresholdBytes: number;
  decodedMemoryThresholdBytes: number;
}

export interface ProgressivePlyNodeManifest {
  id: string;
  level: number;
  bbox: [number, number, number, number, number, number];
  pointCount: number;
  byteLength: number;
  children: string[];
  tileFile: string;
}

export interface ProgressivePlyManifest {
  version: 1;
  complete: true;
  sessionKey: string;
  source: {
    uri: string;
    size: number;
    mtime: number;
    headerHash: string;
    vertexCount: number;
  };
  schema: {
    recordStride: number;
    hasColors: boolean;
    hasNormals: boolean;
    hasIntensity: boolean;
    scalarNames: string[];
  };
  rootId: string;
  gridResolution: number;
  depth: number;
  nodes: ProgressivePlyNodeManifest[];
  bbox: [number, number, number, number, number, number];
}

export interface ProgressiveConfig extends ProgressivePlyDecisionOptions {
  previewPoints: number;
  tileTargetPoints: number;
  localPointBudget: number;
  localMemoryBudgetBytes: number;
  maxTileMessageBytes: number;
}

interface CanonicalPoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  nx: number;
  ny: number;
  nz: number;
  intensity: number;
  scalars: number[];
}

interface Session {
  id: string;
  key: string;
  uri: vscode.Uri;
  panel: vscode.WebviewPanel;
  probe: ProgressivePlyProbe;
  config: ProgressiveConfig;
  cacheDir: string;
  manifest?: ProgressivePlyManifest;
  cancelled: boolean;
}

const TYPE_SIZE: Record<ScalarType, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const STANDARD_PROPERTIES = new Set([
  'x',
  'y',
  'z',
  'red',
  'green',
  'blue',
  'r',
  'g',
  'b',
  'alpha',
  'a',
  'nx',
  'ny',
  'nz',
  'intensity',
]);

function normalizeScalarType(raw: string): ScalarType | null {
  const value = raw.toLowerCase() as ScalarType;
  return Object.prototype.hasOwnProperty.call(TYPE_SIZE, value) ? value : null;
}

function propertyByName(probe: ProgressivePlyProbe, ...names: string[]): ProgressivePlyProperty | undefined {
  const lower = new Set(names.map(name => name.toLowerCase()));
  return probe.properties.find(property => lower.has(property.name.toLowerCase()));
}

function decodedBytesPerPoint(probe: ProgressivePlyProbe): number {
  return (
    12 +
    (probe.hasColors ? 3 : 0) +
    (probe.hasNormals ? 12 : 0) +
    (probe.hasIntensity ? 4 : 0) +
    probe.scalarNames.length * 4
  );
}

export function estimateProgressiveDecodedBytes(probe: ProgressivePlyProbe): number {
  return probe.vertexCount * decodedBytesPerPoint(probe);
}

export function shouldUseProgressivePly(
  probe: ProgressivePlyProbe,
  fileSizeBytes: number,
  options: ProgressivePlyDecisionOptions
): boolean {
  if (!options.enabled || probe.vertexCount <= 0 || probe.faceCount > 0 || probe.isGaussianSplat) {
    return false;
  }
  if (!propertyByName(probe, 'x') || !propertyByName(probe, 'y') || !propertyByName(probe, 'z')) {
    return false;
  }
  if (probe.encoding !== 'ascii' && probe.vertexStride <= 0) {
    return false;
  }
  return (
    fileSizeBytes >= options.fileSizeThresholdBytes ||
    estimateProgressiveDecodedBytes(probe) >= options.decodedMemoryThresholdBytes
  );
}

async function readHeaderBytes(uri: vscode.Uri, maxBytes = 1024 * 1024): Promise<Buffer> {
  const handle = await fs.promises.open(uri.fsPath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const parts: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (total < maxBytes) {
      const toRead = Math.min(chunk.byteLength, maxBytes - total);
      const { bytesRead } = await handle.read(chunk, 0, toRead, position);
      if (bytesRead <= 0) break;
      const part = Buffer.from(chunk.subarray(0, bytesRead));
      parts.push(part);
      total += bytesRead;
      position += bytesRead;
      const combined = Buffer.concat(parts);
      const text = combined.toString('latin1');
      const end = text.indexOf('end_header');
      if (end >= 0) {
        let headerEnd = end + 'end_header'.length;
        if (combined[headerEnd] === 13 && combined[headerEnd + 1] === 10) headerEnd += 2;
        else if (combined[headerEnd] === 10 || combined[headerEnd] === 13) headerEnd += 1;
        return combined.subarray(0, headerEnd);
      }
    }
  } finally {
    await handle.close();
  }
  throw new Error('PLY header exceeds 1 MiB or is missing end_header');
}

export async function probeProgressivePly(uri: vscode.Uri): Promise<ProgressivePlyProbe> {
  const header = await readHeaderBytes(uri);
  const text = header.toString('latin1').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error('Not a PLY file');

  let encoding: ProgressivePlyEncoding | null = null;
  let vertexCount = 0;
  let faceCount = 0;
  let currentElement = '';
  let vertexStride = 0;
  let unsupportedVertexList = false;
  const properties: ProgressivePlyProperty[] = [];
  const comments: string[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      if (
        parts[1] === 'ascii' ||
        parts[1] === 'binary_little_endian' ||
        parts[1] === 'binary_big_endian'
      ) {
        encoding = parts[1];
      }
    } else if (parts[0] === 'comment') {
      comments.push(line.slice('comment'.length).trim());
    } else if (parts[0] === 'element') {
      currentElement = parts[1] ?? '';
      const count = Number(parts[2] ?? 0);
      if (currentElement === 'vertex') vertexCount = count;
      if (currentElement === 'face') faceCount = count;
    } else if (parts[0] === 'property' && currentElement === 'vertex') {
      if (parts[1] === 'list') {
        unsupportedVertexList = true;
        continue;
      }
      const type = normalizeScalarType(parts[1] ?? '');
      const name = parts[2] ?? '';
      if (!type || !name) throw new Error(`Unsupported PLY vertex property: ${line}`);
      properties.push({ name, type, offset: vertexStride, size: TYPE_SIZE[type] });
      vertexStride += TYPE_SIZE[type];
    }
  }

  if (!encoding) throw new Error('PLY header has no supported format');
  if (unsupportedVertexList && encoding !== 'ascii') {
    throw new Error('Progressive binary PLY does not support list-valued vertex properties');
  }

  const names = properties.map(property => property.name.toLowerCase());
  const hasColors =
    (names.includes('red') || names.includes('r')) &&
    (names.includes('green') || names.includes('g')) &&
    (names.includes('blue') || names.includes('b'));
  const hasNormals = names.includes('nx') && names.includes('ny') && names.includes('nz');
  const hasIntensity = names.includes('intensity');
  const isGaussianSplat =
    names.includes('f_dc_0') ||
    names.includes('scale_0') ||
    names.includes('rot_0') ||
    names.some(name => name.startsWith('f_rest_'));
  const scalarNames = properties
    .map(property => property.name)
    .filter(name => !STANDARD_PROPERTIES.has(name.toLowerCase()) && !name.startsWith('f_dc_'))
    .filter(name => !name.startsWith('f_rest_') && !name.startsWith('scale_') && !name.startsWith('rot_'));

  return {
    encoding,
    headerBytes: header.byteLength,
    headerHash: crypto.createHash('sha1').update(header).digest('hex'),
    vertexCount,
    faceCount,
    vertexStride,
    properties,
    scalarNames,
    hasColors,
    hasNormals,
    hasIntensity,
    isGaussianSplat,
    comments,
  };
}

function readNumeric(buffer: Buffer, offset: number, type: ScalarType, littleEndian: boolean): number {
  switch (type) {
    case 'char':
    case 'int8':
      return buffer.readInt8(offset);
    case 'uchar':
    case 'uint8':
      return buffer.readUInt8(offset);
    case 'short':
    case 'int16':
      return littleEndian ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
    case 'ushort':
    case 'uint16':
      return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 'int':
    case 'int32':
      return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    case 'uint':
    case 'uint32':
      return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    case 'float':
    case 'float32':
      return littleEndian ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset);
    case 'double':
    case 'float64':
      return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
  }
}

function normalizedColor(value: number, property: ProgressivePlyProperty | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const floatType =
    property?.type === 'float' ||
    property?.type === 'float32' ||
    property?.type === 'double' ||
    property?.type === 'float64';
  const scaled = floatType && value >= 0 && value <= 1 ? value * 255 : value;
  return Math.max(0, Math.min(255, Math.round(scaled)));
}

function buildPointFromValues(
  probe: ProgressivePlyProbe,
  valueFor: (property: ProgressivePlyProperty, index: number) => number
): CanonicalPoint {
  const byName = new Map<string, { property: ProgressivePlyProperty; index: number }>();
  probe.properties.forEach((property, index) =>
    byName.set(property.name.toLowerCase(), { property, index })
  );
  const get = (...names: string[]) => {
    for (const name of names) {
      const entry = byName.get(name);
      if (entry) return valueFor(entry.property, entry.index);
    }
    return 0;
  };
  const rp = byName.get('red') ?? byName.get('r');
  const gp = byName.get('green') ?? byName.get('g');
  const bp = byName.get('blue') ?? byName.get('b');
  const scalarIndex = new Map(probe.properties.map((property, index) => [property.name, index]));

  return {
    x: get('x'),
    y: get('y'),
    z: get('z'),
    r: normalizedColor(rp ? valueFor(rp.property, rp.index) : 255, rp?.property),
    g: normalizedColor(gp ? valueFor(gp.property, gp.index) : 255, gp?.property),
    b: normalizedColor(bp ? valueFor(bp.property, bp.index) : 255, bp?.property),
    nx: get('nx'),
    ny: get('ny'),
    nz: get('nz'),
    intensity: get('intensity'),
    scalars: probe.scalarNames.map(name => {
      const index = scalarIndex.get(name);
      const property = index === undefined ? undefined : probe.properties[index];
      return property && index !== undefined ? valueFor(property, index) : 0;
    }),
  };
}

async function scanPly(
  uri: vscode.Uri,
  probe: ProgressivePlyProbe,
  onPoint: (point: CanonicalPoint, sourceIndex: number) => void,
  cancelled: () => boolean
): Promise<number> {
  let valid = 0;
  if (probe.encoding === 'ascii') {
    const stream = fs.createReadStream(uri.fsPath, { start: probe.headerBytes, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let sourceIndex = 0;
    try {
      for await (const line of rl) {
        if (cancelled()) throw new Error('Progressive PLY build cancelled');
        if (sourceIndex >= probe.vertexCount) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        const tokens = trimmed.split(/\s+/);
        const point = buildPointFromValues(probe, (_property, index) => Number(tokens[index] ?? 0));
        if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
          onPoint(point, sourceIndex);
          valid++;
        }
        sourceIndex++;
      }
    } finally {
      rl.close();
      stream.destroy();
    }
    return valid;
  }

  const littleEndian = probe.encoding === 'binary_little_endian';
  const handle = await fs.promises.open(uri.fsPath, 'r');
  const recordsPerChunk = Math.max(1, Math.floor((8 * 1024 * 1024) / probe.vertexStride));
  const buffer = Buffer.allocUnsafe(recordsPerChunk * probe.vertexStride);
  let sourceIndex = 0;
  try {
    while (sourceIndex < probe.vertexCount) {
      if (cancelled()) throw new Error('Progressive PLY build cancelled');
      const records = Math.min(recordsPerChunk, probe.vertexCount - sourceIndex);
      const bytes = records * probe.vertexStride;
      const { bytesRead } = await handle.read(
        buffer,
        0,
        bytes,
        probe.headerBytes + sourceIndex * probe.vertexStride
      );
      const complete = Math.floor(bytesRead / probe.vertexStride);
      if (complete <= 0) break;
      for (let local = 0; local < complete; local++) {
        const recordOffset = local * probe.vertexStride;
        const point = buildPointFromValues(probe, property =>
          readNumeric(buffer, recordOffset + property.offset, property.type, littleEndian)
        );
        if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
          onPoint(point, sourceIndex + local);
          valid++;
        }
      }
      sourceIndex += complete;
      if (complete < records) break;
    }
  } finally {
    await handle.close();
  }
  return valid;
}

function canonicalStride(probe: ProgressivePlyProbe): number {
  return decodedBytesPerPoint(probe);
}

function writeCanonical(buffer: Buffer, offset: number, point: CanonicalPoint, probe: ProgressivePlyProbe): number {
  buffer.writeFloatLE(point.x, offset);
  buffer.writeFloatLE(point.y, offset + 4);
  buffer.writeFloatLE(point.z, offset + 8);
  let cursor = offset + 12;
  if (probe.hasColors) {
    buffer[cursor++] = point.r;
    buffer[cursor++] = point.g;
    buffer[cursor++] = point.b;
  }
  if (probe.hasNormals) {
    buffer.writeFloatLE(point.nx, cursor);
    buffer.writeFloatLE(point.ny, cursor + 4);
    buffer.writeFloatLE(point.nz, cursor + 8);
    cursor += 12;
  }
  if (probe.hasIntensity) {
    buffer.writeFloatLE(point.intensity, cursor);
    cursor += 4;
  }
  for (const scalar of point.scalars) {
    buffer.writeFloatLE(scalar, cursor);
    cursor += 4;
  }
  return cursor;
}

function decodeCanonical(buffer: Buffer, probe: ProgressivePlyProbe): {
  positionsArray: Float32Array;
  colorsArray: Uint8Array | null;
  normalsArray: Float32Array | null;
  intensityArray: Float32Array | null;
  scalarFields: Record<string, Float32Array>;
} {
  const stride = canonicalStride(probe);
  const count = Math.floor(buffer.byteLength / stride);
  const positionsArray = new Float32Array(count * 3);
  const colorsArray = probe.hasColors ? new Uint8Array(count * 3) : null;
  const normalsArray = probe.hasNormals ? new Float32Array(count * 3) : null;
  const intensityArray = probe.hasIntensity ? new Float32Array(count) : null;
  const scalarFields: Record<string, Float32Array> = {};
  for (const name of probe.scalarNames) scalarFields[name] = new Float32Array(count);

  for (let index = 0; index < count; index++) {
    let cursor = index * stride;
    const p3 = index * 3;
    positionsArray[p3] = buffer.readFloatLE(cursor);
    positionsArray[p3 + 1] = buffer.readFloatLE(cursor + 4);
    positionsArray[p3 + 2] = buffer.readFloatLE(cursor + 8);
    cursor += 12;
    if (colorsArray) {
      colorsArray[p3] = buffer[cursor++];
      colorsArray[p3 + 1] = buffer[cursor++];
      colorsArray[p3 + 2] = buffer[cursor++];
    }
    if (normalsArray) {
      normalsArray[p3] = buffer.readFloatLE(cursor);
      normalsArray[p3 + 1] = buffer.readFloatLE(cursor + 4);
      normalsArray[p3 + 2] = buffer.readFloatLE(cursor + 8);
      cursor += 12;
    }
    if (intensityArray) {
      intensityArray[index] = buffer.readFloatLE(cursor);
      cursor += 4;
    }
    for (const name of probe.scalarNames) {
      scalarFields[name][index] = buffer.readFloatLE(cursor);
      cursor += 4;
    }
  }
  return { positionsArray, colorsArray, normalsArray, intensityArray, scalarFields };
}

function configFromWorkspace(): ProgressiveConfig {
  const config = vscode.workspace.getConfiguration('plyViewer.progressivePly');
  const mb = 1024 * 1024;
  return {
    enabled: config.get<boolean>('enabled', true),
    fileSizeThresholdBytes: config.get<number>('fileSizeThresholdMB', 256) * mb,
    decodedMemoryThresholdBytes: config.get<number>('decodedMemoryThresholdMB', 512) * mb,
    previewPoints: Math.max(10_000, config.get<number>('previewPoints', 250_000)),
    tileTargetPoints: Math.max(10_000, config.get<number>('tileTargetPoints', 150_000)),
    localPointBudget: Math.max(100_000, config.get<number>('localPointBudget', 4_000_000)),
    localMemoryBudgetBytes: Math.max(64, config.get<number>('localMemoryBudgetMB', 256)) * mb,
    maxTileMessageBytes: Math.max(4, config.get<number>('maxTileMessageMB', 16)) * mb,
  };
}

function bboxForCell(
  bbox: [number, number, number, number, number, number],
  resolution: number,
  ix: number,
  iy: number,
  iz: number
): [number, number, number, number, number, number] {
  const dx = (bbox[3] - bbox[0]) / resolution || 1;
  const dy = (bbox[4] - bbox[1]) / resolution || 1;
  const dz = (bbox[5] - bbox[2]) / resolution || 1;
  return [
    bbox[0] + ix * dx,
    bbox[1] + iy * dy,
    bbox[2] + iz * dz,
    bbox[0] + (ix + 1) * dx,
    bbox[1] + (iy + 1) * dy,
    bbox[2] + (iz + 1) * dz,
  ];
}

function safeCell(value: number, min: number, max: number, resolution: number): number {
  if (!(max > min)) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(resolution - 1, Math.floor(normalized * resolution)));
}

export class ProgressivePlySessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly panelSessions = new Map<vscode.WebviewPanel, Set<string>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (line: string) => void,
    private readonly configOverride: Partial<ProgressiveConfig> = {}
  ) {}

  async startIfLarge(
    uri: vscode.Uri,
    panel: vscode.WebviewPanel,
    shortPath: string
  ): Promise<boolean> {
    if (path.extname(uri.fsPath).toLowerCase() !== '.ply') return false;
    const config = { ...configFromWorkspace(), ...this.configOverride };
    if (!config.enabled) return false;

    let stat: vscode.FileStat;
    let probe: ProgressivePlyProbe;
    try {
      [stat, probe] = await Promise.all([vscode.workspace.fs.stat(uri), probeProgressivePly(uri)]);
    } catch (error) {
      this.log(`Progressive PLY probe failed, using normal loader: ${String(error)}`);
      return false;
    }
    if (!shouldUseProgressivePly(probe, stat.size, config)) return false;

    const key = crypto
      .createHash('sha1')
      .update(`${uri.toString()}|${stat.size}|${stat.mtime}|${probe.headerHash}`)
      .digest('hex');
    const id = `ply-${key.slice(0, 16)}-${Date.now().toString(36)}`;
    const cacheDir = path.join(this.context.globalStorageUri.fsPath, 'progressive-ply', key);
    const session: Session = { id, key, uri, panel, probe, config, cacheDir, cancelled: false };
    this.sessions.set(id, session);
    const ids = this.panelSessions.get(panel) ?? new Set<string>();
    ids.add(id);
    this.panelSessions.set(panel, ids);

    await fs.promises.mkdir(cacheDir, { recursive: true });
    const manifestPath = path.join(cacheDir, 'manifest.json');
    try {
      const cached = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as ProgressivePlyManifest;
      if (
        cached.complete &&
        cached.version === 1 &&
        cached.source.size === stat.size &&
        cached.source.mtime === stat.mtime &&
        cached.source.headerHash === probe.headerHash
      ) {
        session.manifest = cached;
        const root = cached.nodes.find(node => node.id === cached.rootId);
        if (!root) throw new Error('Progressive cache manifest has no root node');
        const rootBytes = await fs.promises.readFile(path.join(cacheDir, root.tileFile));
        await this.postStart(session, shortPath, stat.size, cached.bbox, rootBytes, cached);
        this.log(`Progressive PLY cache hit: ${path.basename(uri.fsPath)} (${probe.vertexCount} pts)`);
        return true;
      }
    } catch {
      // Missing, stale, or incomplete cache: rebuild below.
    }

    const started = performance.now();
    const { bbox, previewBuffer, validCount } = await this.buildPreview(session);
    if (session.cancelled) return true;
    const rootFile = 'root.tile';
    await fs.promises.writeFile(path.join(cacheDir, rootFile), previewBuffer);
    const rootNode: ProgressivePlyNodeManifest = {
      id: 'root',
      level: 0,
      bbox,
      pointCount: Math.floor(previewBuffer.byteLength / canonicalStride(probe)),
      byteLength: previewBuffer.byteLength,
      children: [],
      tileFile: rootFile,
    };
    const provisional: ProgressivePlyManifest = {
      version: 1,
      complete: true,
      sessionKey: key,
      source: {
        uri: uri.toString(),
        size: stat.size,
        mtime: stat.mtime,
        headerHash: probe.headerHash,
        vertexCount: validCount,
      },
      schema: {
        recordStride: canonicalStride(probe),
        hasColors: probe.hasColors,
        hasNormals: probe.hasNormals,
        hasIntensity: probe.hasIntensity,
        scalarNames: probe.scalarNames,
      },
      rootId: 'root',
      gridResolution: 1,
      depth: 0,
      nodes: [rootNode],
      bbox,
    };
    await this.postStart(session, shortPath, stat.size, bbox, previewBuffer, provisional);
    this.log(
      `Progressive PLY preview ready in ${(performance.now() - started).toFixed(0)}ms: ${path.basename(uri.fsPath)}`
    );

    void this.buildLeaves(session, stat, bbox, validCount, rootNode).catch(async error => {
      if (!session.cancelled) {
        this.log(`Progressive PLY cache build failed: ${String(error)}`);
        await panel.webview.postMessage({
          type: 'progressivePly:error',
          sessionId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return true;
  }

  private async buildPreview(session: Session): Promise<{
    bbox: [number, number, number, number, number, number];
    previewBuffer: Buffer;
    validCount: number;
  }> {
    const { probe, config } = session;
    const stride = Math.max(1, Math.ceil(probe.vertexCount / config.previewPoints));
    const recordStride = canonicalStride(probe);
    const capacity = Math.min(config.previewPoints, Math.ceil(probe.vertexCount / stride));
    const preview = Buffer.allocUnsafe(Math.max(1, capacity) * recordStride);
    let previewCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    const validCount = await scanPly(
      session.uri,
      probe,
      (point, sourceIndex) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        minZ = Math.min(minZ, point.z);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        maxZ = Math.max(maxZ, point.z);
        if (sourceIndex % stride === 0 && previewCount < capacity) {
          writeCanonical(preview, previewCount * recordStride, point, probe);
          previewCount++;
        }
      },
      () => session.cancelled
    );
    if (!Number.isFinite(minX)) throw new Error('PLY contains no finite XYZ points');
    return {
      bbox: [minX, minY, minZ, maxX, maxY, maxZ],
      previewBuffer: preview.subarray(0, previewCount * recordStride),
      validCount,
    };
  }

  private async buildLeaves(
    session: Session,
    stat: vscode.FileStat,
    bbox: [number, number, number, number, number, number],
    validCount: number,
    rootNode: ProgressivePlyNodeManifest
  ): Promise<void> {
    const { probe, config, cacheDir } = session;
    const recordStride = canonicalStride(probe);
    const messageLimitedTarget = Math.max(
      10_000,
      Math.floor((config.maxTileMessageBytes * 0.75) / recordStride)
    );
    const tileTarget = Math.max(10_000, Math.min(config.tileTargetPoints, messageLimitedTarget));
    const desiredLeaves = Math.max(1, Math.ceil(validCount / tileTarget));
    const desiredResolution = Math.max(1, Math.ceil(Math.cbrt(desiredLeaves)));
    const depth = Math.min(6, Math.max(0, Math.ceil(Math.log2(desiredResolution))));
    const resolution = Math.pow(2, depth);
    const tileDir = path.join(cacheDir, 'tiles');
    await fs.promises.rm(tileDir, { recursive: true, force: true });
    await fs.promises.mkdir(tileDir, { recursive: true });

    type TileState = { id: string; ix: number; iy: number; iz: number; count: number; buffered: number; buffer: Buffer; file: string };
    const chunkPoints = Math.max(256, Math.min(4096, Math.floor((512 * 1024) / recordStride)));
    const tiles = new Map<string, TileState>();
    let processed = 0;
    const emitProgress = () => {
      void session.panel.webview.postMessage({
        type: 'progressivePly:progress',
        sessionId: session.id,
        phase: 'index',
        fraction: Math.min(1, processed / Math.max(1, probe.vertexCount)),
      });
    };

    const flush = (tile: TileState) => {
      if (tile.buffered <= 0) return;
      fs.appendFileSync(tile.file, tile.buffer.subarray(0, tile.buffered * recordStride));
      tile.buffered = 0;
    };

    await scanPly(
      session.uri,
      probe,
      point => {
        const ix = safeCell(point.x, bbox[0], bbox[3], resolution);
        const iy = safeCell(point.y, bbox[1], bbox[4], resolution);
        const iz = safeCell(point.z, bbox[2], bbox[5], resolution);
        const id = `l${depth}_${ix}_${iy}_${iz}`;
        let tile = tiles.get(id);
        if (!tile) {
          const file = path.join(tileDir, `${id}.tile`);
          fs.rmSync(file, { force: true });
          tile = {
            id,
            ix,
            iy,
            iz,
            count: 0,
            buffered: 0,
            buffer: Buffer.allocUnsafe(chunkPoints * recordStride),
            file,
          };
          tiles.set(id, tile);
        }
        writeCanonical(tile.buffer, tile.buffered * recordStride, point, probe);
        tile.buffered++;
        tile.count++;
        if (tile.buffered >= chunkPoints) flush(tile);
        processed++;
        if (processed % 1_000_000 === 0) emitProgress();
      },
      () => session.cancelled
    );
    for (const tile of tiles.values()) flush(tile);
    if (session.cancelled) return;

    const children = [...tiles.values()]
      .filter(tile => tile.count > 0)
      .map(tile => tile.id)
      .sort();
    rootNode.children = children;
    const nodes: ProgressivePlyNodeManifest[] = [
      rootNode,
      ...[...tiles.values()]
        .filter(tile => tile.count > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(tile => ({
          id: tile.id,
          level: depth,
          bbox: bboxForCell(bbox, resolution, tile.ix, tile.iy, tile.iz),
          pointCount: tile.count,
          byteLength: tile.count * recordStride,
          children: [],
          tileFile: path.relative(cacheDir, tile.file).replace(/\\/g, '/'),
        })),
    ];

    const manifest: ProgressivePlyManifest = {
      version: 1,
      complete: true,
      sessionKey: session.key,
      source: {
        uri: session.uri.toString(),
        size: stat.size,
        mtime: stat.mtime,
        headerHash: probe.headerHash,
        vertexCount: validCount,
      },
      schema: {
        recordStride,
        hasColors: probe.hasColors,
        hasNormals: probe.hasNormals,
        hasIntensity: probe.hasIntensity,
        scalarNames: probe.scalarNames,
      },
      rootId: 'root',
      gridResolution: resolution,
      depth,
      nodes,
      bbox,
    };
    const tmp = path.join(cacheDir, 'manifest.json.tmp');
    await fs.promises.writeFile(tmp, JSON.stringify(manifest));
    await fs.promises.rename(tmp, path.join(cacheDir, 'manifest.json'));
    session.manifest = manifest;
    await session.panel.webview.postMessage({
      type: 'progressivePly:manifest',
      sessionId: session.id,
      manifest,
      budgets: {
        localPointBudget: config.localPointBudget,
        localMemoryBudgetBytes: config.localMemoryBudgetBytes,
      },
    });
    await session.panel.webview.postMessage({
      type: 'progressivePly:progress',
      sessionId: session.id,
      phase: 'ready',
      fraction: 1,
    });
    this.log(
      `Progressive PLY LOD ready: ${path.basename(session.uri.fsPath)} · ${validCount.toLocaleString()} pts · ${children.length} spatial tiles`
    );
  }

  private async postStart(
    session: Session,
    shortPath: string,
    fileSizeInBytes: number,
    bbox: [number, number, number, number, number, number],
    previewBuffer: Buffer,
    manifest: ProgressivePlyManifest
  ): Promise<void> {
    const decoded = decodeCanonical(previewBuffer, session.probe);
    const vertexCount = decoded.positionsArray.length / 3;
    await session.panel.webview.postMessage({
      type: 'progressivePly:start',
      sessionId: session.id,
      manifest,
      budgets: {
        localPointBudget: session.config.localPointBudget,
        localMemoryBudgetBytes: session.config.localMemoryBudgetBytes,
      },
      data: {
        vertices: [],
        faces: [],
        format: session.probe.encoding,
        version: '1.0',
        comments: session.probe.comments,
        vertexCount,
        sourcePointCount: session.probe.vertexCount,
        faceCount: 0,
        hasColors: session.probe.hasColors,
        hasNormals: session.probe.hasNormals,
        hasIntensity: session.probe.hasIntensity,
        fileName: path.basename(session.uri.fsPath),
        shortPath,
        fileSizeInBytes,
        positionsArray: decoded.positionsArray,
        colorsArray: decoded.colorsArray,
        normalsArray: decoded.normalsArray,
        intensityArray: decoded.intensityArray,
        scalarFields: decoded.scalarFields,
        useTypedArrays: true,
        metadata: {
          progressivePly: true,
          progressivePlySessionId: session.id,
          sourcePointCount: session.probe.vertexCount,
          sourceBounds: bbox,
          recommendedPointSize: 1,
        },
      },
    });
  }

  async handleTileRequest(
    panel: vscode.WebviewPanel,
    message: { sessionId?: string; generation?: number; nodeIds?: string[] }
  ): Promise<void> {
    const session = typeof message.sessionId === 'string' ? this.sessions.get(message.sessionId) : undefined;
    if (!session || session.panel !== panel || session.cancelled || !session.manifest) return;
    const ids = Array.isArray(message.nodeIds) ? message.nodeIds.slice(0, 64) : [];
    const byId = new Map(session.manifest.nodes.map(node => [node.id, node]));
    for (const id of ids) {
      if (id === session.manifest.rootId) continue;
      const node = byId.get(id);
      if (!node || node.byteLength > session.config.maxTileMessageBytes) continue;
      const bytes = await fs.promises.readFile(path.join(session.cacheDir, node.tileFile));
      if (session.cancelled) return;
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await panel.webview.postMessage({
        type: 'progressivePly:tile',
        sessionId: session.id,
        generation: message.generation ?? 0,
        nodeId: id,
        pointCount: node.pointCount,
        byteLength: bytes.byteLength,
        buffer: arrayBuffer,
      });
    }
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.cancelled = true;
  }

  disposePanel(panel: vscode.WebviewPanel): void {
    for (const id of this.panelSessions.get(panel) ?? []) {
      const session = this.sessions.get(id);
      if (session) session.cancelled = true;
      this.sessions.delete(id);
    }
    this.panelSessions.delete(panel);
  }
}
