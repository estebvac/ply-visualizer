import * as fs from 'fs';
import { parseProgressivePlyHeader } from './header';
import { shouldEagerlyPrefetchPly, type ProgressivePlyRoutingConfig } from './routing';

/**
 * Decide whether it is safe to inject a whole-file fetch into the initial
 * webview HTML. This helper reads at most 64 KiB and never allocates the body.
 *
 * Files that may need progressive LOD must be left entirely to the extension
 * host's loader, including small-on-disk clouds whose decoded representation
 * exceeds the configured memory threshold.
 */
export function probeEagerBinaryPlyPrefetch(
  filePath: string,
  config: ProgressivePlyRoutingConfig
): number | null {
  const handle = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(handle).size;
    // Also refuse prefetch when the size alone triggers progressive routing.
    // A malformed or overlong header should not start an unbounded fetch.
    if (!Number.isFinite(size) || size < 0 || size >= config.fileSizeThresholdBytes) {
      return null;
    }

    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const bytesRead = fs.readSync(handle, head, 0, head.byteLength, 0);
    let header;
    try {
      header = parseProgressivePlyHeader(head.subarray(0, bytesRead));
    } catch {
      return null;
    }
    if (header.format === 'ascii' || !shouldEagerlyPrefetchPly(size, header, config)) {
      return null;
    }
    return size;
  } finally {
    fs.closeSync(handle);
  }
}
