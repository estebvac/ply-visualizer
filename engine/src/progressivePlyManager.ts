import * as THREE from 'three';
import type { SpatialData } from './interfaces';
import { createVoxelMesh, disposeVoxelMesh } from './visualization/VoxelRenderer';

interface ProgressiveNode {
  id: string;
  level: number;
  bounds: [number, number, number, number, number, number];
  sourceCount: number;
  sampleCount: number;
  children: string[];
  leafPageCount: number;
}

interface ProgressiveManifest {
  sourceOrigin: [number, number, number];
  bounds: [number, number, number, number, number, number];
  tilePoints: number;
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  scalarFieldNames: string[];
  nodes: Record<string, ProgressiveNode>;
}

interface PointPayload {
  positions: Float32Array;
  colors: Uint8Array | null;
  normals: Float32Array | null;
  intensity: Float32Array | null;
  scalarFields: Record<string, Float32Array>;
  count: number;
  sourceOrigin: [number, number, number];
}

interface CachedTile {
  payload: PointPayload;
  bytes: number;
  lastUsed: number;
}

interface ProgressiveSession {
  id: string;
  fileName: string;
  shortPath: string;
  fileSizeInBytes: number;
  sourcePointCount: number;
  format: 'binary_little_endian' | 'binary_big_endian';
  comments: string[];
  hasColors: boolean;
  hasNormals: boolean;
  hasIntensity: boolean;
  scalarFieldNames: string[];
  memoryBudgetBytes: number;
  pointBudget: number;
  bytesPerPoint: number;
  manifest: ProgressiveManifest | null;
  tileCache: Map<string, CachedTile>;
  selected: string[];
  pending: Set<string>;
  generation: number;
  selectionTimer: number | null;
  previewCreated: boolean;
  previewPayload: PointPayload | null;
  isAddFile: boolean;
  /** Shift from this PLY's source origin into the scene's shared source origin. */
  positionOffset: [number, number, number];
}

export interface ProgressivePlyViewerHost {
  spatialFiles: SpatialData[];
  meshes: THREE.Object3D[];
  camera: THREE.PerspectiveCamera;
  renderer: { domElement: HTMLCanvasElement };
  vscode: { postMessage(message: any): void };
  scene: THREE.Scene;
  voxelObjects: (THREE.InstancedMesh | null)[];
  voxelsVisible: boolean[];
  voxelSizes: number[];
  individualColorModes: string[];
  displayFiles(dataArray: SpatialData[]): Promise<void>;
  addNewFiles(dataArray: SpatialData[]): void;
  onFileColorModeChange(fileIndex: number, value: string): void;
  requestRender(): void;
}

function asFloat32(value: unknown): Float32Array {
  return value instanceof Float32Array ? value : new Float32Array(value as ArrayLike<number>);
}

function asUint8(value: unknown): Uint8Array | null {
  if (value == null) return null;
  return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayLike<number>);
}

function payloadFromMessage(raw: any): PointPayload {
  const scalarFields: Record<string, Float32Array> = {};
  for (const [name, values] of Object.entries(raw.scalarFields ?? {})) {
    scalarFields[name] = asFloat32(values);
  }
  return {
    positions: asFloat32(raw.positions),
    colors: asUint8(raw.colors),
    normals: raw.normals == null ? null : asFloat32(raw.normals),
    intensity: raw.intensity == null ? null : asFloat32(raw.intensity),
    scalarFields,
    count: Number(raw.count ?? 0),
    sourceOrigin: raw.sourceOrigin as [number, number, number],
  };
}

function payloadBytes(payload: PointPayload): number {
  let bytes = payload.positions.byteLength;
  bytes += payload.colors?.byteLength ?? 0;
  bytes += payload.normals?.byteLength ?? 0;
  bytes += payload.intensity?.byteLength ?? 0;
  for (const values of Object.values(payload.scalarFields)) bytes += values.byteLength;
  return bytes;
}

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class ProgressivePlyManager {
  private readonly sessions = new Map<string, ProgressiveSession>();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionMatrix = new THREE.Matrix4();

  constructor(private readonly host: ProgressivePlyViewerHost) {}

  async handleMessage(message: any): Promise<boolean> {
    switch (message?.type) {
      case 'progressivePly:start':
        this.handleStart(message);
        return true;
      case 'progressivePly:preview':
        await this.handlePreview(message);
        return true;
      case 'progressivePly:ready':
        this.handleReady(message);
        return true;
      case 'progressivePly:tile':
        this.handleTile(message);
        return true;
      case 'progressivePly:tileError':
        this.handleTileError(message);
        return true;
      case 'progressivePly:progress':
        return true;
      case 'progressivePly:panelVisibility':
        this.handlePanelVisibility(!!message.visible);
        return true;
      case 'progressivePly:error':
        console.error('Progressive PLY error:', message.error);
        return true;
      default:
        return false;
    }
  }

  onCameraChanged(): void {
    for (const session of this.sessions.values()) this.scheduleSelection(session);
  }

  private handlePanelVisibility(visible: boolean): void {
    for (const session of this.sessions.values()) {
      if (visible) {
        this.scheduleSelection(session, 0);
        continue;
      }
      if (session.selectionTimer !== null) {
        window.clearTimeout(session.selectionTimer);
        session.selectionTimer = null;
      }
      if (!session.manifest || !session.previewCreated) continue;
      session.selected = ['node:'];
      session.generation++;
      session.pending.clear();

      // Hidden retained webviews should not keep a full fine-LOD cache alive.
      // Preserve at most the tiny root tile and the bounded preview.
      const root = session.tileCache.get('node:');
      session.tileCache.clear();
      if (root) {
        root.lastUsed = performance.now();
        session.tileCache.set('node:', root);
        this.applySelectedTiles(session);
      } else {
        if (session.previewPayload) this.applyPayload(session, session.previewPayload);
        this.requestMissing(session);
      }
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.selectionTimer !== null) window.clearTimeout(session.selectionTimer);
    }
    this.sessions.clear();
  }

  private handleStart(message: any): void {
    const hasColors = !!message.hasColors;
    const hasNormals = !!message.hasNormals;
    const hasIntensity = !!message.hasIntensity;
    const scalarFieldNames = Array.isArray(message.scalarFieldNames)
      ? message.scalarFieldNames.map(String)
      : [];
    const bytesPerPoint =
      12 +
      (hasColors ? 3 : 0) +
      (hasNormals ? 12 : 0) +
      (hasIntensity ? 4 : 0) +
      scalarFieldNames.length * 4;
    const memoryBudgetBytes =
      Math.max(64, Number(message.localMemoryBudgetMiB ?? 256)) * 1024 * 1024;
    // Resident tile payloads and the merged render payload coexist. Leave a
    // third share for color-mode attributes, transient replacement geometry,
    // and JS/Three.js overhead so the configured budget remains a real bound
    // rather than just an LRU target.
    const memoryBoundPoints = Math.max(
      50_000,
      Math.floor(memoryBudgetBytes / Math.max(1, bytesPerPoint * 3))
    );
    const requestedPointBudget = Math.max(
      50_000,
      Number(message.pointBudget ?? 4_000_000)
    );

    this.sessions.set(String(message.sessionId), {
      id: String(message.sessionId),
      fileName: String(message.fileName ?? 'large.ply'),
      shortPath: String(message.shortPath ?? message.fileName ?? 'large.ply'),
      fileSizeInBytes: Number(message.fileSizeInBytes ?? 0),
      sourcePointCount: Number(message.sourcePointCount ?? 0),
      format: message.format === 'binary_big_endian' ? 'binary_big_endian' : 'binary_little_endian',
      comments: Array.isArray(message.comments) ? message.comments.map(String) : [],
      hasColors,
      hasNormals,
      hasIntensity,
      scalarFieldNames,
      memoryBudgetBytes,
      pointBudget: Math.min(requestedPointBudget, memoryBoundPoints),
      bytesPerPoint,
      manifest: null,
      tileCache: new Map(),
      selected: [],
      pending: new Set(),
      generation: 0,
      selectionTimer: null,
      previewCreated: false,
      previewPayload: null,
      isAddFile: !!message.isAddFile,
      positionOffset: [0, 0, 0],
    });
  }

  private async handlePreview(message: any): Promise<void> {
    const session = this.sessions.get(String(message.sessionId));
    if (!session) return;
    const payload = payloadFromMessage(message.payload);
    session.previewPayload = payload;
    if (!session.previewCreated) {
      const data: SpatialData = {
        vertices: [],
        faces: [],
        format: session.format,
        version: '1.0',
        comments: session.comments,
        vertexCount: payload.count,
        sourcePointCount: session.sourcePointCount,
        faceCount: 0,
        hasColors: session.hasColors,
        hasNormals: session.hasNormals,
        hasIntensity: session.hasIntensity,
        fileName: session.fileName,
        shortPath: session.shortPath,
        fileSizeInBytes: session.fileSizeInBytes,
        positionsArray: payload.positions,
        colorsArray: payload.colors,
        normalsArray: payload.normals,
        intensityArray: payload.intensity,
        scalarFields: payload.scalarFields,
        useTypedArrays: true,
        sourceOrigin: payload.sourceOrigin,
        metadata: {
          progressivePly: true,
          progressivePlySessionId: session.id,
          progressiveSourcePointCount: session.sourcePointCount,
          progressiveResidentPointCount: payload.count,
        },
      };
      if (session.isAddFile) {
        this.host.addNewFiles([data]);
      } else {
        await this.host.displayFiles([data]);
      }
      session.previewCreated = true;
      // addNewFiles/displayFiles runs alignSourceOrigin(), which may shift this
      // first preview into an already-loaded cloud's local frame. Capture that
      // exact shift once and apply it to every later tile/refinement payload.
      const fileIndex = this.fileIndex(session);
      const alignedOrigin = fileIndex >= 0
        ? this.host.spatialFiles[fileIndex]?.sourceOrigin
        : undefined;
      if (alignedOrigin) {
        session.positionOffset = [
          payload.sourceOrigin[0] - alignedOrigin[0],
          payload.sourceOrigin[1] - alignedOrigin[1],
          payload.sourceOrigin[2] - alignedOrigin[2],
        ];
      }
    } else {
      this.applyPayload(session, payload);
    }
  }

  private handleReady(message: any): void {
    const session = this.sessions.get(String(message.sessionId));
    if (!session) return;
    session.manifest = message.manifest as ProgressiveManifest;
    this.scheduleSelection(session, 0);
  }

  private handleTile(message: any): void {
    const session = this.sessions.get(String(message.sessionId));
    if (!session || Number(message.generation) !== session.generation) return;
    const tileId = String(message.tileId);
    session.pending.delete(tileId);
    const payload = payloadFromMessage(message.payload);
    session.tileCache.set(tileId, {
      payload,
      bytes: payloadBytes(payload),
      lastUsed: performance.now(),
    });
    this.evictTiles(session);
    this.requestMissing(session);
    if (session.selected.every(id => session.tileCache.has(id))) {
      this.applySelectedTiles(session);
    }
  }

  private handleTileError(message: any): void {
    const session = this.sessions.get(String(message.sessionId));
    if (!session || Number(message.generation) !== session.generation) return;
    session.pending.delete(String(message.tileId));
    console.warn('Progressive PLY tile failed:', message.tileId, message.error);
  }

  private scheduleSelection(session: ProgressiveSession, delay = 120): void {
    if (!session.manifest || !session.previewCreated) return;
    if (session.selectionTimer !== null) window.clearTimeout(session.selectionTimer);
    session.selectionTimer = window.setTimeout(() => {
      session.selectionTimer = null;
      this.updateSelection(session);
    }, delay);
  }

  private fileIndex(session: ProgressiveSession): number {
    return this.host.spatialFiles.findIndex(
      data => data.metadata?.progressivePlySessionId === session.id
    );
  }

  private updateSelection(session: ProgressiveSession): void {
    const manifest = session.manifest;
    const fileIndex = this.fileIndex(session);
    if (!manifest || fileIndex < 0) {
      if (fileIndex < 0 && session.previewCreated) this.sessions.delete(session.id);
      return;
    }
    const mesh = this.host.meshes[fileIndex];
    if (!mesh) return;

    this.host.camera.updateMatrixWorld();
    mesh.updateMatrixWorld(true);
    this.projectionMatrix.multiplyMatrices(
      this.host.camera.projectionMatrix,
      this.host.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projectionMatrix);

    const selected: string[] = [];
    const budget = { remaining: session.pointBudget };
    this.selectNode(session, manifest, mesh, '', budget, selected, true);
    if (selected.length === 0) selected.push('node:');
    selected.sort();

    if (sameSelection(selected, session.selected)) {
      for (const id of selected) {
        const tile = session.tileCache.get(id);
        if (tile) tile.lastUsed = performance.now();
      }
      return;
    }

    session.selected = selected;
    session.generation++;
    session.pending.clear();
    this.evictTiles(session);
    this.requestMissing(session);
    if (selected.every(id => session.tileCache.has(id))) this.applySelectedTiles(session);
  }

  private selectNode(
    session: ProgressiveSession,
    manifest: ProgressiveManifest,
    mesh: THREE.Object3D,
    nodeId: string,
    budget: { remaining: number },
    selected: string[],
    root = false
  ): void {
    const node = manifest.nodes[nodeId];
    if (!node || budget.remaining <= 0) return;
    if (!root && !this.nodeVisible(mesh, node)) return;

    const diameter = this.projectedDiameter(mesh, node);
    if (node.children.length > 0 && diameter > 180) {
      const minimumChildCost = node.children.reduce(
        (sum, childId) => sum + Math.max(1, manifest.nodes[childId]?.sampleCount ?? 0),
        0
      );
      if (minimumChildCost <= budget.remaining) {
        const ordered = [...node.children].sort(
          (a, b) => this.projectedDiameter(mesh, manifest.nodes[b]) -
                    this.projectedDiameter(mesh, manifest.nodes[a])
        );
        for (const childId of ordered) {
          this.selectNode(session, manifest, mesh, childId, budget, selected);
        }
        return;
      }
    }

    if (node.leafPageCount > 0 && diameter > 350) {
      let added = false;
      for (let page = 0; page < node.leafPageCount; page++) {
        const pageCount = Math.min(
          manifest.tilePoints,
          node.sourceCount - page * manifest.tilePoints
        );
        if (pageCount <= 0 || pageCount > budget.remaining) break;
        selected.push(`leaf:${node.id}:${page}`);
        budget.remaining -= pageCount;
        added = true;
      }
      if (added) return;
    }

    if (node.sampleCount > 0 && node.sampleCount <= budget.remaining) {
      selected.push(`node:${node.id}`);
      budget.remaining -= node.sampleCount;
    }
  }

  private nodeVisible(mesh: THREE.Object3D, node: ProgressiveNode): boolean {
    const bounds = node.bounds;
    const box = new THREE.Box3(
      new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
      new THREE.Vector3(bounds[3], bounds[4], bounds[5])
    );
    box.applyMatrix4(mesh.matrixWorld);
    return this.frustum.intersectsBox(box);
  }

  private projectedDiameter(mesh: THREE.Object3D, node: ProgressiveNode): number {
    const b = node.bounds;
    const center = new THREE.Vector3(
      (b[0] + b[3]) / 2,
      (b[1] + b[4]) / 2,
      (b[2] + b[5]) / 2
    ).applyMatrix4(mesh.matrixWorld);
    const localSize = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    const scale = new THREE.Vector3();
    mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const worldSize = localSize * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    const distance = Math.max(1e-6, center.distanceTo(this.host.camera.position));
    const height = Math.max(1, this.host.renderer.domElement.clientHeight);
    const pixelsPerWorld =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(this.host.camera.fov) / 2) * distance);
    return worldSize * pixelsPerWorld;
  }

  private requestMissing(session: ProgressiveSession): void {
    const missing = session.selected.filter(
      id => !session.tileCache.has(id) && !session.pending.has(id)
    );
    if (missing.length === 0) return;
    const batch = missing.slice(0, 32);
    for (const id of batch) session.pending.add(id);
    this.host.vscode.postMessage({
      type: 'progressivePly:requestTiles',
      sessionId: session.id,
      generation: session.generation,
      tileIds: batch,
    });
  }

  private evictTiles(session: ProgressiveSession): void {
    let bytes = 0;
    for (const tile of session.tileCache.values()) bytes += tile.bytes;
    if (bytes <= session.memoryBudgetBytes) return;
    const selected = new Set(session.selected);
    const candidates = [...session.tileCache.entries()]
      .filter(([id]) => !selected.has(id))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, tile] of candidates) {
      if (bytes <= session.memoryBudgetBytes) break;
      session.tileCache.delete(id);
      bytes -= tile.bytes;
    }
  }

  private applySelectedTiles(session: ProgressiveSession): void {
    const payloads = session.selected
      .map(id => session.tileCache.get(id)?.payload)
      .filter((payload): payload is PointPayload => !!payload);
    if (payloads.length !== session.selected.length || payloads.length === 0) return;
    const total = payloads.reduce((sum, payload) => sum + payload.count, 0);
    const merged: PointPayload = {
      positions: new Float32Array(total * 3),
      colors: session.hasColors ? new Uint8Array(total * 3) : null,
      normals: session.hasNormals ? new Float32Array(total * 3) : null,
      intensity: session.hasIntensity ? new Float32Array(total) : null,
      scalarFields: Object.fromEntries(
        session.scalarFieldNames.map(name => [name, new Float32Array(total)])
      ),
      count: total,
      sourceOrigin: session.manifest?.sourceOrigin ?? [0, 0, 0],
    };
    let offset = 0;
    for (const payload of payloads) {
      merged.positions.set(payload.positions, offset * 3);
      if (merged.colors && payload.colors) merged.colors.set(payload.colors, offset * 3);
      if (merged.normals && payload.normals) merged.normals.set(payload.normals, offset * 3);
      if (merged.intensity && payload.intensity) merged.intensity.set(payload.intensity, offset);
      for (const name of session.scalarFieldNames) {
        const source = payload.scalarFields[name];
        if (source) merged.scalarFields[name].set(source, offset);
      }
      offset += payload.count;
    }
    this.applyPayload(session, merged);
  }

  private applyPayload(session: ProgressiveSession, payload: PointPayload): void {
    const fileIndex = this.fileIndex(session);
    if (fileIndex < 0) return;
    const data = this.host.spatialFiles[fileIndex];
    const mesh = this.host.meshes[fileIndex];
    if (!(mesh instanceof THREE.Points)) return;

    let positions = payload.positions;
    const [dx, dy, dz] = session.positionOffset;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      positions = payload.positions.slice();
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += dx;
        positions[i + 1] += dy;
        positions[i + 2] += dz;
      }
    }
    data.positionsArray = positions;
    data.colorsArray = payload.colors;
    data.normalsArray = payload.normals;
    data.intensityArray = payload.intensity;
    data.scalarFields = payload.scalarFields;
    data.vertexCount = payload.count;
    data.sourcePointCount = session.sourcePointCount;
    // Keep the scene-aligned sourceOrigin established by alignSourceOrigin().
    data.metadata = {
      ...(data.metadata ?? {}),
      progressivePly: true,
      progressivePlySessionId: session.id,
      progressiveSourcePointCount: session.sourcePointCount,
      progressiveResidentPointCount: payload.count,
    };

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const oldGeometry = mesh.geometry;
    mesh.geometry = geometry;
    oldGeometry.dispose();

    const colorMode = this.host.individualColorModes[fileIndex] ?? 'assigned';
    this.host.onFileColorModeChange(fileIndex, colorMode);

    if (this.host.voxelsVisible[fileIndex]) {
      const oldVoxels = this.host.voxelObjects[fileIndex];
      if (oldVoxels) {
        this.host.scene.remove(oldVoxels);
        disposeVoxelMesh(oldVoxels);
      }
      const voxels = createVoxelMesh(mesh, this.host.voxelSizes[fileIndex] ?? 0.1);
      voxels.matrix.copy(mesh.matrix);
      voxels.matrixAutoUpdate = false;
      voxels.visible = true;
      this.host.voxelObjects[fileIndex] = voxels;
      this.host.scene.add(voxels);
    }
    this.host.requestRender();
  }
}
