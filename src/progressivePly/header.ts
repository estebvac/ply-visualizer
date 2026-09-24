export type ProgressivePlyScalarType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64';

export interface ProgressivePlyProperty {
  name: string;
  type: ProgressivePlyScalarType;
  byteOffset: number;
  byteSize: number;
}

export interface ProgressivePlyHeader {
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  littleEndian: boolean;
  headerBytes: number;
  vertexCount: number;
  faceCount: number;
  vertexStride: number | null;
  properties: ProgressivePlyProperty[];
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  scalarFieldNames: string[];
  isGaussianSplat: boolean;
  comments: string[];
}

const TYPE_INFO: Record<string, { type: ProgressivePlyScalarType; size: number }> = {
  char: { type: 'int8', size: 1 },
  int8: { type: 'int8', size: 1 },
  uchar: { type: 'uint8', size: 1 },
  uint8: { type: 'uint8', size: 1 },
  short: { type: 'int16', size: 2 },
  int16: { type: 'int16', size: 2 },
  ushort: { type: 'uint16', size: 2 },
  uint16: { type: 'uint16', size: 2 },
  int: { type: 'int32', size: 4 },
  int32: { type: 'int32', size: 4 },
  uint: { type: 'uint32', size: 4 },
  uint32: { type: 'uint32', size: 4 },
  float: { type: 'float32', size: 4 },
  float32: { type: 'float32', size: 4 },
  double: { type: 'float64', size: 8 },
  float64: { type: 'float64', size: 8 },
};

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode('end_header');
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    let end = i + marker.length;
    while (end < bytes.length && (bytes[end] === 13 || bytes[end] === 10)) end++;
    return end;
  }
  return -1;
}

export function parseProgressivePlyHeader(bytes: Uint8Array): ProgressivePlyHeader {
  const headerBytes = findHeaderEnd(bytes);
  if (headerBytes < 0) throw new Error('PLY header is larger than the probe window');

  const text = new TextDecoder('latin1').decode(bytes.subarray(0, headerBytes));
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error('Invalid PLY header');

  let format: ProgressivePlyHeader['format'] = 'ascii';
  let vertexCount = 0;
  let faceCount = 0;
  let currentElement = '';
  let vertexSeen = false;
  let vertexStride: number | null = 0;
  const properties: ProgressivePlyProperty[] = [];
  const comments: string[] = [];

  for (const line of lines.slice(1)) {
    const tokens = line.split(/\s+/);
    if (tokens[0] === 'format') {
      if (
        tokens[1] !== 'ascii' &&
        tokens[1] !== 'binary_little_endian' &&
        tokens[1] !== 'binary_big_endian'
      ) {
        throw new Error(`Unsupported PLY format: ${tokens[1]}`);
      }
      format = tokens[1] as ProgressivePlyHeader['format'];
    } else if (tokens[0] === 'comment') {
      comments.push(line.slice('comment'.length).trim());
    } else if (tokens[0] === 'element') {
      currentElement = tokens[1] ?? '';
      const count = Number(tokens[2] ?? 0);
      if (currentElement === 'vertex') {
        vertexCount = count;
        vertexSeen = true;
      } else if (currentElement === 'face') {
        faceCount = count;
      }
    } else if (tokens[0] === 'property' && currentElement === 'vertex') {
      if (tokens[1] === 'list') {
        vertexStride = null;
        continue;
      }
      if (vertexStride === null) continue;
      const info = TYPE_INFO[tokens[1]];
      if (!info) {
        vertexStride = null;
        continue;
      }
      properties.push({
        name: tokens[2],
        type: info.type,
        byteOffset: vertexStride,
        byteSize: info.size,
      });
      vertexStride += info.size;
    }
  }

  if (!vertexSeen || !Number.isFinite(vertexCount) || vertexCount < 0) {
    throw new Error('PLY header has no valid vertex element');
  }

  const names = new Set(properties.map(property => property.name.toLowerCase()));
  for (const axis of ['x', 'y', 'z']) {
    if (!names.has(axis)) throw new Error(`PLY vertex schema is missing ${axis}`);
  }
  const hasColors =
    (names.has('red') && names.has('green') && names.has('blue')) ||
    (names.has('r') && names.has('g') && names.has('b'));
  const hasNormals = names.has('nx') && names.has('ny') && names.has('nz');
  const hasIntensity = names.has('intensity');
  const reserved = new Set([
    'x','y','z','red','green','blue','r','g','b','nx','ny','nz','intensity',
  ]);
  const scalarFieldNames = properties
    .map(property => property.name)
    .filter(name => !reserved.has(name.toLowerCase()));
  const isGaussianSplat =
    names.has('f_dc_0') ||
    names.has('scale_0') ||
    names.has('rot_0') ||
    names.has('opacity');

  return {
    format,
    littleEndian: format !== 'binary_big_endian',
    headerBytes,
    vertexCount,
    faceCount,
    vertexStride,
    properties,
    hasColors,
    hasNormals,
    hasIntensity,
    scalarFieldNames,
    isGaussianSplat,
    comments,
  };
}
