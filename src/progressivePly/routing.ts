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
  vertexDataStartsAtBody: boolean;
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
    !header.fixedVertexStride ||
    !header.vertexDataStartsAtBody
  ) {
    return false;
  }
  return (
    fileSizeBytes >= config.fileSizeThresholdBytes ||
    estimateDecodedPlyBytes(header) >= config.decodedBytesThresholdBytes
  );
}


export function supportsProgressivePlyUri(uri: { scheme: string; fsPath: string }): boolean {
  return (
    (uri.scheme === 'file' || uri.scheme === 'vscode-remote') &&
    /\.ply$/i.test(uri.fsPath)
  );
}

/**
 * Initial HTML PLY prefetch bypasses the extension host and parses the entire
 * file in the viewer. It must not compete with remote progressive LOD.
 *
 * Be conservative for files at/above the configured disk threshold even if
 * their 64-KiB probe is unparseable: the extension loader will decide which
 * fallback to use, without silently allocating a whole cloud during startup.
 * The decoded-memory threshold also applies to physically smaller PLYs.
 */
export function shouldEagerlyPrefetchPly(
  fileSizeBytes: number,
  header: ProgressivePlyRoutingHeader | null,
  config: ProgressivePlyRoutingConfig = DEFAULT_PROGRESSIVE_PLY_ROUTING
): boolean {
  return (
    Number.isFinite(fileSizeBytes) &&
    fileSizeBytes >= 0 &&
    fileSizeBytes < config.fileSizeThresholdBytes &&
    !(header && shouldUseProgressivePly(fileSizeBytes, header, config))
  );
}
