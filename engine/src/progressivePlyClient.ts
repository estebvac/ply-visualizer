import * as THREE from 'three';
import {
  createVoxelMesh,
  disposeVoxelMesh,
  updateVoxelSize,
} from './visualization/VoxelRenderer';

export interface ProgressiveNode {
  id: string;
  level: number;
  bbox: [number, number, number, number, number, number];
  pointCount: number;
  byteLength: number;
  children: string[];
  tileFile: string;
}

export interface ProgressiveManifest {
  version: 1;
  complete: true;
  rootId: string;
  gridResolution: number;
  depth: number;
  nodes: ProgressiveNode[];
  bbox: [number, number, number, number, number, number];
  schema: {
    recordStride: number;
    hasColors: boolean;
    hasNormals: boolean;
    hasIntensity: boolean;
    scalarNames: string[];
  };
}

interface ResidentTile {
  nodeId: string;
  points: THREE.Points;
  voxel: THREE.InstancedMesh | null;
  byteLength: number;
  pointCount: number;
  lastUsed: number;
}

interface ClientSession {
  sessionId: string;
  fileIndex: number;
  manifest: ProgressiveManifest;
  nodeById: Map<string, ProgressiveNode>;
  resident: Map<string, ResidentTile>;
  pending: Set<string>;
  requestedGeneration: number;
  desiredKey: string;
  localPointBudget: number;
  localMemoryBudgetBytes: number;
  hidden: boolean;
}

function asArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return null;
}

export function decodeProgressiveTile(
  buffer: ArrayBuffer,
  manifest: ProgressiveManifest
): {
  positions: Float32Array;
  colors: Uint8Array | null;
  normals: Float32Array | null;
  intensity: Float32Array | null;
  scalars: Record<string, Float32Array>;
} {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const stride = manifest.schema.recordStride;
  const count = Math.floor(buffer.byteLength / stride);
  const positions = new Float32Array(count * 3);
  const colors = manifest.schema.hasColors ? new Uint8Array(count * 3) : null;
  const normals = manifest.schema.hasNormals ? new Float32Array(count * 3) : null;
  const intensity = manifest.schema.hasIntensity ? new Float32Array(count) : null;
  const scalars: Record<string, Float32Array> = {};
  for (const name of manifest.schema.scalarNames) scalars[name] = new Float32Array(count);

  for (let index = 0; index < count; index++) {
    let cursor = index * stride;
    const p3 = index * 3;
    positions[p3] = view.getFloat32(cursor, true);
    positions[p3 + 1] = view.getFloat32(cursor + 4, true);
    positions[p3 + 2] = view.getFloat32(cursor + 8, true);
    cursor += 12;
    if (colors) {
      colors[p3] = bytes[cursor++];
      colors[p3 + 1] = bytes[cursor++];
      colors[p3 + 2] = bytes[cursor++];
    }
    if (normals) {
      normals[p3] = view.getFloat32(cursor, true);
      normals[p3 + 1] = view.getFloat32(cursor + 4, true);
      normals[p3 + 2] = view.getFloat32(cursor + 8, true);
      cursor += 12;
    }
    if (intensity) {
      intensity[index] = view.getFloat32(cursor, true);
      cursor += 4;
    }
    for (const name of manifest.schema.scalarNames) {
      scalars[name][index] = view.getFloat32(cursor, true);
      cursor += 4;
    }
  }
  return { positions, colors, normals, intensity, scalars };
}

function boxFromTuple(tuple: ProgressiveNode['bbox']): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(tuple[0], tuple[1], tuple[2]),
    new THREE.Vector3(tuple[3], tuple[4], tuple[5])
  );
}

export class ProgressivePlyClient {
  private readonly sessions = new Map<string, ClientSession>();
  private lastCameraUpdate = 0;

  constructor(private readonly host: any) {
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden;
      for (const session of this.sessions.values()) {
        session.hidden = hidden;
        if (hidden) {
          this.evictAllFineTiles(session);
        } else {
          session.desiredKey = '';
          this.host.requestRender();
        }
      }
    });
  }

  async handleStart(message: any): Promise<void> {
    const data = message.data;
    if (!data || typeof message.sessionId !== 'string') return;
    await this.host.displayFiles([data]);
    const fileIndex = data.fileIndex;
    if (!Number.isInteger(fileIndex)) return;
    const manifest = message.manifest as ProgressiveManifest;
    const budgets = message.budgets ?? {};
    const session: ClientSession = {
      sessionId: message.sessionId,
      fileIndex,
      manifest,
      nodeById: new Map(manifest.nodes.map(node => [node.id, node])),
      resident: new Map(),
      pending: new Set(),
      requestedGeneration: 0,
      desiredKey: '',
      localPointBudget: Math.max(100_000, Number(budgets.localPointBudget) || 4_000_000),
      localMemoryBudgetBytes: Math.max(
        64 * 1024 * 1024,
        Number(budgets.localMemoryBudgetBytes) || 256 * 1024 * 1024
      ),
      hidden: document.hidden,
    };
    this.sessions.set(message.sessionId, session);
    const source = this.host.meshes[fileIndex] as THREE.Object3D | undefined;
    if (source) {
      source.userData.progressivePlySessionId = message.sessionId;
      source.userData.progressivePlySourcePointCount =
        data.sourcePointCount ?? data.metadata?.sourcePointCount;
    }
    this.host.requestRender();
    if (manifest.depth > 0) this.updateCamera(true);
  }

  handleManifest(message: any): void {
    const session = this.sessions.get(message.sessionId);
    if (!session || !message.manifest) return;
    session.manifest = message.manifest as ProgressiveManifest;
    session.nodeById = new Map(session.manifest.nodes.map(node => [node.id, node]));
    if (message.budgets) {
      session.localPointBudget =
        Number(message.budgets.localPointBudget) || session.localPointBudget;
      session.localMemoryBudgetBytes =
        Number(message.budgets.localMemoryBudgetBytes) || session.localMemoryBudgetBytes;
    }
    session.desiredKey = '';
    this.updateCamera(true);
  }

  handleProgress(message: any): void {
    const fraction = Math.max(0, Math.min(1, Number(message.fraction) || 0));
    if (message.phase === 'index') {
      this.host.setLoadingDetail?.(`Building remote LOD cache (${Math.round(fraction * 100)}%)…`);
    } else if (message.phase === 'ready') {
      this.host.showStatus?.('Remote PLY LOD cache ready');
    }
  }

  handleError(message: any): void {
    console.warn('Progressive PLY:', message.error);
    this.host.showStatus?.(`Progressive PLY refinement stopped: ${message.error}`);
  }

  handleTile(message: any): void {
    const session = this.sessions.get(message.sessionId);
    if (!session || session.hidden) return;
    const node = session.nodeById.get(message.nodeId);
    const raw = asArrayBuffer(message.buffer);
    if (!node || !raw) return;
    session.pending.delete(node.id);

    const source = this.host.meshes[session.fileIndex];
    if (!(source instanceof THREE.Points)) return;
    if (session.resident.has(node.id)) {
      session.resident.get(node.id)!.lastUsed = performance.now();
      return;
    }

    const decoded = decodeProgressiveTile(raw, session.manifest);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
    if (decoded.colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(decoded.colors, 3, true));
    }
    if (decoded.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3));
    if (decoded.intensity) geometry.setAttribute('intensity', new THREE.BufferAttribute(decoded.intensity, 1));
    for (const [name, values] of Object.entries(decoded.scalars)) {
      geometry.setAttribute(`scalar_${name}`, new THREE.BufferAttribute(values, 1));
    }
    geometry.boundingBox = boxFromTuple(node.bbox);
    geometry.computeBoundingSphere();

    // Share the source material so color/point-size/gamma mode changes remain
    // consistent across all resident LOD tiles without duplicating materials.
    const points = new THREE.Points(geometry, source.material);
    points.name = `${source.name || 'Point cloud'} · LOD ${node.id}`;
    points.frustumCulled = true;
    points.userData.progressivePlyNodeId = node.id;
    source.add(points);

    const resident: ResidentTile = {
      nodeId: node.id,
      points,
      voxel: null,
      byteLength: node.byteLength,
      pointCount: node.pointCount,
      lastUsed: performance.now(),
    };
    session.resident.set(node.id, resident);
    this.syncTileVoxel(session, resident);
    this.enforceBudget(session, new Set([node.id]));
    this.host.requestRender();
  }

  updateCamera(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastCameraUpdate < 120) return;
    this.lastCameraUpdate = now;

    for (const session of this.sessions.values()) {
      if (session.hidden || session.manifest.depth <= 0) continue;
      const source = this.host.meshes[session.fileIndex];
      if (!(source instanceof THREE.Points) || !source.visible) continue;

      source.updateWorldMatrix(true, true);
      this.host.camera.updateMatrixWorld(true);
      const projectionView = new THREE.Matrix4().multiplyMatrices(
        this.host.camera.projectionMatrix,
        this.host.camera.matrixWorldInverse
      );
      const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
      const candidates: Array<{ node: ProgressiveNode; distance: number }> = [];
      for (const node of session.manifest.nodes) {
        if (node.id === session.manifest.rootId || node.children.length > 0) continue;
        const worldBox = boxFromTuple(node.bbox).applyMatrix4(source.matrixWorld);
        if (!frustum.intersectsBox(worldBox)) continue;
        const center = worldBox.getCenter(new THREE.Vector3());
        candidates.push({ node, distance: Math.max(1e-6, center.distanceTo(this.host.camera.position)) });
      }
      candidates.sort((a, b) => a.distance - b.distance);

      const desired: ProgressiveNode[] = [];
      let points = 0;
      for (const candidate of candidates) {
        if (desired.length >= 64) break;
        if (points + candidate.node.pointCount > session.localPointBudget && desired.length > 0) break;
        desired.push(candidate.node);
        points += candidate.node.pointCount;
      }
      const ids = desired.map(node => node.id);
      const key = ids.join('|');
      const selected = new Set(ids);
      for (const id of selected) {
        const resident = session.resident.get(id);
        if (resident) resident.lastUsed = now;
      }
      this.enforceBudget(session, selected);
      if (key === session.desiredKey) continue;
      session.desiredKey = key;
      session.requestedGeneration++;
      const missing = ids.filter(id => !session.resident.has(id) && !session.pending.has(id));
      if (missing.length) {
        missing.forEach(id => session.pending.add(id));
        this.host.vscode?.postMessage({
          type: 'progressivePly:requestTiles',
          sessionId: session.sessionId,
          generation: session.requestedGeneration,
          nodeIds: missing.slice(0, 32),
        });
      }
    }
  }

  syncVoxelMode(fileIndex: number): void {
    for (const session of this.sessions.values()) {
      if (session.fileIndex !== fileIndex) continue;
      for (const resident of session.resident.values()) this.syncTileVoxel(session, resident);
    }
  }

  syncVoxelSize(fileIndex: number, size: number): void {
    for (const session of this.sessions.values()) {
      if (session.fileIndex !== fileIndex) continue;
      for (const resident of session.resident.values()) {
        if (resident.voxel) updateVoxelSize(resident.voxel, size);
      }
    }
  }

  removeFile(fileIndex: number): void {
    for (const [id, session] of [...this.sessions.entries()]) {
      if (session.fileIndex === fileIndex) {
        this.evictAllFineTiles(session);
        this.host.vscode?.postMessage({ type: 'progressivePly:cancel', sessionId: id });
        this.sessions.delete(id);
      } else if (session.fileIndex > fileIndex) {
        session.fileIndex--;
      }
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      this.evictAllFineTiles(session);
      this.host.vscode?.postMessage({ type: 'progressivePly:cancel', sessionId: session.sessionId });
    }
    this.sessions.clear();
  }

  private syncTileVoxel(session: ClientSession, resident: ResidentTile): void {
    const enabled = !!this.host.voxelsVisible?.[session.fileIndex];
    const rootVoxel = this.host.voxelObjects?.[session.fileIndex] as THREE.InstancedMesh | null;
    if (!enabled || !rootVoxel) {
      if (resident.voxel) {
        resident.voxel.removeFromParent();
        disposeVoxelMesh(resident.voxel);
        resident.voxel = null;
      }
      resident.points.visible = true;
      return;
    }
    resident.points.visible = false;
    if (!resident.voxel) {
      resident.voxel = createVoxelMesh(
        resident.points,
        this.host.voxelSizes?.[session.fileIndex] ?? 0.1
      );
      rootVoxel.add(resident.voxel);
    }
  }

  private enforceBudget(session: ClientSession, selected: Set<string>): void {
    let bytes = 0;
    for (const resident of session.resident.values()) bytes += resident.byteLength;
    if (bytes <= session.localMemoryBudgetBytes) return;
    const evictable = [...session.resident.values()]
      .filter(tile => !selected.has(tile.nodeId))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const tile of evictable) {
      if (bytes <= session.localMemoryBudgetBytes) break;
      bytes -= tile.byteLength;
      this.disposeTile(session, tile);
    }
  }

  private evictAllFineTiles(session: ClientSession): void {
    for (const tile of [...session.resident.values()]) this.disposeTile(session, tile);
    session.pending.clear();
    session.desiredKey = '';
  }

  private disposeTile(session: ClientSession, tile: ResidentTile): void {
    if (tile.voxel) {
      tile.voxel.removeFromParent();
      disposeVoxelMesh(tile.voxel);
    }
    tile.points.removeFromParent();
    tile.points.geometry.dispose();
    session.resident.delete(tile.nodeId);
  }
}
