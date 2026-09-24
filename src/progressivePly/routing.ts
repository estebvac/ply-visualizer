export interface ProgressivePlyRoutingConfig {
  fileSizeThresholdBytes: number;
  decodedBytesThresholdBytes: number;
}

export interface ProgressivePlyRoutingHeader {
  format: 'binary_little_endian' | 'binary_big_endian' | 'ascii';
  vertexCount: number;
  faceCount: number;
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  scalarFieldNames: string[];
  isGaussianSplat: boolean;
  fixedVertexStride: number | null;
}

export const DEFAULT_PROGRESSIVE_PLY_ROUTING: ProgressivePlyRoutingConfig = {
  fileSizeThresholdBytes: 256 * 1024 * 1024,
  decodedBytesThresholdBytes: 512 * 1024 * 1024,
};

export function estimateDecodedPlyBytes(header: ProgressivePlyRoutingHeader): number {
  const perPoint =
    3 * 4 +
    (header.hasColors ? 3 : 0) +
    (header.hasNormals ? 3 * 4 : 0) +
    (header.hasIntensity ? 4 : 0) +
    header.scalarFieldNames.length * 4;
  return header.vertexCount * perPoint;
}

export function shouldUseProgressivePly(
  fileSizeBytes: number,
  header: ProgressivePlyRoutingHeader,
  config: ProgressivePlyRoutingConfig = DEFAULT_PROGRESSIVE_PLY_ROUTING
): boolean {
  if (
    header.format === 'ascii' ||
    header.faceCount !== 0 ||
    header.vertexCount <= 0 ||
    header.isGaussianSplat ||
    !header.fixedVertexStride
  ) {
    return false;
  }
  return (
    fileSizeBytes >= config.fileSizeThresholdBytes ||
    estimateDecodedPlyBytes(header) >= config.decodedBytesThresholdBytes
  );
}
