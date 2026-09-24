import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  buildProgressiveCache,
  buildProgressivePreview,
  DEFAULT_PROGRESSIVE_BUILD_OPTIONS,
  loadProgressiveManifest,
  progressiveCacheKey,
  readProgressiveTile,
  type ProgressivePlyBuildOptions,
  type ProgressivePlyManifest,
  type ProgressivePointPayload,
} from './cache';
import { parseProgressivePlyHeader, type ProgressivePlyHeader } from './header';
import {
  DEFAULT_PROGRESSIVE_PLY_ROUTING,
  shouldUseProgressivePly,
  type ProgressivePlyRoutingConfig,
} from './routing';

interface ProgressiveSession {
  id: string;
  panel: vscode.WebviewPanel;
  documentUri: vscode.Uri;
  cacheDirectory: string;
  header: ProgressivePlyHeader;
  manifest: ProgressivePlyManifest | null;
  buildPromise: Promise<ProgressivePlyManifest> | null;
  cancelled: boolean;
}

export interface ProgressivePlyOpenMetadata {
  fileName: string;
  shortPath: string;
  loadStartedAt: number;
  isAddFile?: boolean;
}

const MAX_HEADER_BYTES = 1024 * 1024;
const TILE_MESSAGE_BYTES = 24 * 1024 * 1024;

export function supportsProgressivePlyUri(uri: { scheme: string; fsPath: string }): boolean {
  return (
    (uri.scheme === 'file' || uri.scheme === 'vscode-remote') &&
    path.extname(uri.fsPath).toLowerCase() === '.ply'
  );
}

async function readHeaderProbe(filePath: string): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    let size = 64 * 1024;
    while (size <= MAX_HEADER_BYTES) {
      const buffer = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      const probe = buffer.subarray(0, bytesRead);
      try {
        parseProgressivePlyHeader(probe);
        return probe;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('larger than the probe window') ||
          bytesRead < size
        ) {
          throw error;
        }
      }
      size *= 2;
    }
    throw new Error(`PLY header exceeds the ${MAX_HEADER_BYTES / 1024} KiB progressive limit`);
  } finally {
    await handle.close();
  }
}

function routingConfig(): ProgressivePlyRoutingConfig {
  const config = vscode.workspace.getConfiguration('plyViewer.largePly');
  const fileMiB = config.get<number>('progressiveFileSizeMiB', 256);
  const decodedMiB = config.get<number>('progressiveDecodedSizeMiB', 512);
  return {
    fileSizeThresholdBytes: Math.max(1, fileMiB) * 1024 * 1024,
    decodedBytesThresholdBytes: Math.max(1, decodedMiB) * 1024 * 1024,
  };
}

function buildOptions(header: ProgressivePlyHeader): ProgressivePlyBuildOptions {
  const config = vscode.workspace.getConfiguration('plyViewer.largePly');
  const configuredPreviewPoints = Math.max(
    10_000,
    config.get<number>('previewPoints', 500_000)
  );
  const configuredTilePoints = Math.max(10_000, config.get<number>('tilePoints', 200_000));
  const lodSamplePoints = Math.max(5_000, config.get<number>('lodSamplePoints', 50_000));
  const normalizedBytesPerPoint =
    12 +
    (header.hasColors ? 3 : 0) +
    (header.hasNormals ? 12 : 0) +
    (header.hasIntensity ? 4 : 0) +
    header.scalarFieldNames.length * 4;
  const localBudgetBytes =
    Math.max(64, config.get<number>('localMemoryBudgetMiB', 256)) * 1024 * 1024;
  // Keep the initial preview well below the resident-memory budget even for
  // clouds with many scalar fields. The viewer still needs room for geometry,
  // colors, tile cache, and Three.js overhead.
  const previewPoints = Math.max(
    10_000,
    Math.min(
      configuredPreviewPoints,
      Math.floor(localBudgetBytes / Math.max(1, normalizedBytesPerPoint * 4))
    )
  );
  const boundedTilePoints = Math.max(
    10_000,
    Math.min(configuredTilePoints, Math.floor(TILE_MESSAGE_BYTES / normalizedBytesPerPoint))
  );
  return {
    ...DEFAULT_PROGRESSIVE_BUILD_OPTIONS,
    previewPoints,
    tilePoints: boundedTilePoints,
    lodSamplePoints: Math.min(lodSamplePoints, boundedTilePoints),
  };
}

function payloadMessage(payload: ProgressivePointPayload): Record<string, unknown> {
  return {
    count: payload.count,
    positions: payload.positions,
    colors: payload.colors,
    normals: payload.normals,
    intensity: payload.intensity,
    scalarFields: payload.scalarFields,
    sourceOrigin: payload.sourceOrigin,
  };
}

function cacheRoot(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'progressive-ply');
}

export class ProgressivePlyService {
  private readonly sessions = new Map<string, ProgressiveSession>();
  private readonly panelSessions = new Map<vscode.WebviewPanel, Set<string>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logPerf: (line: string) => void
  ) {}

  async maybeOpen(
    documentUri: vscode.Uri,
    panel: vscode.WebviewPanel,
    metadata: ProgressivePlyOpenMetadata
  ): Promise<boolean> {
    // Under Remote-SSH workspace resources use the vscode-remote scheme, but
    // this extension runs in the workspace extension host and documentUri.fsPath
    // is the real path on the remote machine. Keep all heavy I/O there.
    if (!supportsProgressivePlyUri(documentUri)) {
      return false;
    }

    const stat = await vscode.workspace.fs.stat(documentUri);
    const probe = await readHeaderProbe(documentUri.fsPath);
    const header = parseProgressivePlyHeader(probe);
    if (!shouldUseProgressivePly(stat.size, {
      format: header.format,
      vertexCount: header.vertexCount,
      faceCount: header.faceCount,
      hasColors: header.hasColors,
      hasNormals: header.hasNormals,
      hasIntensity: header.hasIntensity,
      scalarFieldNames: header.scalarFieldNames,
      isGaussianSplat: header.isGaussianSplat,
      fixedVertexStride: header.vertexStride,
    }, routingConfig())) {
      return false;
    }

    const root = cacheRoot(this.context);
    await fs.promises.mkdir(root, { recursive: true });
    const key = progressiveCacheKey(documentUri.fsPath, stat.size, stat.mtime, probe.subarray(0, header.headerBytes));
    const directory = path.join(root, key);
    const session: ProgressiveSession = {
      id: crypto.randomUUID(),
      panel,
      documentUri,
      cacheDirectory: directory,
      header,
      manifest: null,
      buildPromise: null,
      cancelled: false,
    };
    this.sessions.set(session.id, session);
    let panelSet = this.panelSessions.get(panel);
    if (!panelSet) {
      panelSet = new Set();
      this.panelSessions.set(panel, panelSet);
    }
    panelSet.add(session.id);

    await panel.webview.postMessage({
      type: 'progressivePly:start',
      sessionId: session.id,
      fileName: metadata.fileName,
      shortPath: metadata.shortPath,
      fileSizeInBytes: stat.size,
      sourcePointCount: header.vertexCount,
      hasColors: header.hasColors,
      hasNormals: header.hasNormals,
      hasIntensity: header.hasIntensity,
      scalarFieldNames: header.scalarFieldNames,
      format: header.format,
      comments: header.comments,
      localMemoryBudgetMiB: vscode.workspace
        .getConfiguration('plyViewer.largePly')
        .get<number>('localMemoryBudgetMiB', 256),
      pointBudget: vscode.workspace
        .getConfiguration('plyViewer.largePly')
        .get<number>('visiblePointBudget', 4_000_000),
      isAddFile: !!metadata.isAddFile,
      loadStartedAt: metadata.loadStartedAt,
    });

    const cached = await loadProgressiveManifest(directory);
    if (cached) {
      session.manifest = cached;
      const preview = await readProgressiveTile(directory, cached, 'node:');
      await this.postPreview(session, metadata, preview, true);
      await panel.webview.postMessage({
        type: 'progressivePly:ready',
        sessionId: session.id,
        manifest: cached,
        cacheHit: true,
      });
      this.logPerf(
        `⏱️ PERF[ply-progressive/ext] cache hit · ${header.vertexCount.toLocaleString()} source pts · ${metadata.fileName}`
      );
      return true;
    }

    const options = buildOptions(header);
    const started = performance.now();
    let lastProgress = 0;
    const previewResult = await buildProgressivePreview(
      documentUri.fsPath,
      header,
      options,
      fraction => {
        if (session.cancelled) return;
        if (fraction - lastProgress >= 0.02 || fraction === 1) {
          lastProgress = fraction;
          void panel.webview.postMessage({
            type: 'progressivePly:progress',
            sessionId: session.id,
            phase: 'preview',
            fraction,
          });
        }
      },
      async partial => {
        if (!session.cancelled) await this.postPreview(session, metadata, partial, false);
      },
      () => session.cancelled
    );
    if (session.cancelled) return true;
    await this.postPreview(session, metadata, previewResult.preview, true);
    this.logPerf(
      `⏱️ PERF[ply-progressive/ext] preview ${(performance.now() - started).toFixed(1)}ms · ${previewResult.preview.count.toLocaleString()} / ${header.vertexCount.toLocaleString()} pts · ${metadata.fileName}`
    );

    session.buildPromise = buildProgressiveCache(
      documentUri.fsPath,
      directory,
      header,
      { size: stat.size, mtime: stat.mtime },
      previewResult,
      options,
      (phase, fraction) => {
        if (!session.cancelled) {
          void panel.webview.postMessage({
            type: 'progressivePly:progress',
            sessionId: session.id,
            phase,
            fraction,
          });
        }
      },
      () => session.cancelled
    )
      .then(async manifest => {
        session.manifest = manifest;
        if (!session.cancelled) {
          await panel.webview.postMessage({
            type: 'progressivePly:ready',
            sessionId: session.id,
            manifest,
            cacheHit: false,
          });
        }
        return manifest;
      })
      .catch(async error => {
        if (!session.cancelled) {
          await panel.webview.postMessage({
            type: 'progressivePly:error',
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      });
    // Cache construction continues on the remote extension host after the
    // preview is visible. Avoid an unhandled rejection if the panel disappears.
    void session.buildPromise.catch(() => undefined);
    return true;
  }

  async handleMessage(panel: vscode.WebviewPanel, message: any): Promise<boolean> {
    if (message?.type !== 'progressivePly:requestTiles') return false;
    const session = this.sessions.get(String(message.sessionId ?? ''));
    if (!session || session.panel !== panel || session.cancelled) return true;
    const manifest = session.manifest ?? (session.buildPromise ? await session.buildPromise : null);
    if (!manifest || session.cancelled) return true;

    const generation = Number(message.generation ?? 0);
    const tileIds = Array.isArray(message.tileIds)
      ? message.tileIds.slice(0, 32).map(String)
      : [];
    for (const tileId of tileIds) {
      if (session.cancelled) break;
      try {
        const payload = await readProgressiveTile(session.cacheDirectory, manifest, tileId);
        await panel.webview.postMessage({
          type: 'progressivePly:tile',
          sessionId: session.id,
          generation,
          tileId,
          payload: payloadMessage(payload),
        });
      } catch (error) {
        await panel.webview.postMessage({
          type: 'progressivePly:tileError',
          sessionId: session.id,
          generation,
          tileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return true;
  }

  disposePanel(panel: vscode.WebviewPanel): void {
    for (const id of this.panelSessions.get(panel) ?? []) {
      const session = this.sessions.get(id);
      if (session) session.cancelled = true;
      this.sessions.delete(id);
    }
    this.panelSessions.delete(panel);
  }

  private async postPreview(
    session: ProgressiveSession,
    metadata: ProgressivePlyOpenMetadata,
    payload: ProgressivePointPayload,
    final: boolean
  ): Promise<void> {
    await session.panel.webview.postMessage({
      type: 'progressivePly:preview',
      sessionId: session.id,
      fileName: metadata.fileName,
      shortPath: metadata.shortPath,
      fileSizeInBytes: (await vscode.workspace.fs.stat(session.documentUri)).size,
      sourcePointCount: session.header.vertexCount,
      format: session.header.format,
      comments: session.header.comments,
      hasColors: session.header.hasColors,
      hasNormals: session.header.hasNormals,
      hasIntensity: session.header.hasIntensity,
      scalarFieldNames: session.header.scalarFieldNames,
      payload: payloadMessage(payload),
      isAddFile: !!metadata.isAddFile,
      final,
    });
  }
}
