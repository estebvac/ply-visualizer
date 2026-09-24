import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { ProgressivePlyManager } from '../src/progressivePlyManager';

test('progressive PLY manager bounds point residency and request bursts', async () => {
  const originalWindow = (globalThis as any).window;
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });

  const messages: any[] = [];
  const spatialFiles: any[] = [];
  const meshes: THREE.Object3D[] = [];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10_000);
  camera.position.set(0, -20, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const host: any = {
    spatialFiles,
    meshes,
    camera,
    renderer: { domElement: { clientHeight: 720 } },
    vscode: { postMessage: (message: any) => messages.push(message) },
    scene,
    voxelObjects: [],
    voxelsVisible: [],
    voxelSizes: [],
    individualColorModes: [],
    displayFiles: async (items: any[]) => {
      for (const data of items) {
        spatialFiles.push(data);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positionsArray, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial());
        meshes.push(points);
        scene.add(points);
      }
    },
    addNewFiles: (items: any[]) => {
      for (const data of items) {
        spatialFiles.push(data);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positionsArray, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial());
        meshes.push(points);
        scene.add(points);
      }
    },
    onFileColorModeChange: () => undefined,
    requestRender: () => undefined,
  };

  try {
    const manager = new ProgressivePlyManager(host);
    await manager.handleMessage({
      type: 'progressivePly:start',
      sessionId: 's1',
      fileName: 'large.ply',
      shortPath: 'remote/large.ply',
      fileSizeInBytes: 1_500_000_000,
      sourcePointCount: 80_000_000,
      format: 'binary_little_endian',
      hasColors: true,
      hasNormals: true,
      hasIntensity: true,
      scalarFieldNames: ['classification', 'confidence'],
      localMemoryBudgetMiB: 64,
      pointBudget: 4_000_000,
    });

    const session = (manager as any).sessions.get('s1');
    expect(session).toBeTruthy();
    messages.length = 0;
    (manager as any).announceGeneration(session);
    expect(messages).toEqual([
      {
        type: 'progressivePly:requestTiles',
        sessionId: 's1',
        generation: 0,
        tileIds: [],
      },
    ]);
    // An empty cancellation fence is intentionally sent even when the new view
    // needs no remote bytes; this lets the extension stop an older generation.
    messages.length = 0;
    // 12 pos + 3 RGB + 12 normals + 4 intensity + 8 scalar = 39 bytes/point.
    expect(session.bytesPerPoint).toBe(39);
    expect(session.pointBudget).toBeLessThanOrEqual(
      Math.floor((64 * 1024 * 1024) / (39 * 4))
    );

    const previewCount = 1_000;
    await manager.handleMessage({
      type: 'progressivePly:preview',
      sessionId: 's1',
      payload: {
        count: previewCount,
        positions: new Float32Array(previewCount * 3),
        colors: new Uint8Array(previewCount * 3),
        normals: new Float32Array(previewCount * 3),
        intensity: new Float32Array(previewCount),
        scalarFields: {
          classification: new Float32Array(previewCount),
          confidence: new Float32Array(previewCount),
        },
        sourceOrigin: [0, 0, 0],
      },
    });
    expect(session.activePayloadBytes).toBe(previewCount * 39);

    session.manifest = {
      sourceOrigin: [0, 0, 0],
      bounds: [-10, -10, -10, 10, 10, 10],
      tilePoints: 200_000,
      hasColors: true,
      hasNormals: true,
      hasIntensity: true,
      scalarFieldNames: ['classification', 'confidence'],
      nodes: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          String(index),
          {
            id: String(index),
            level: 1,
            bounds: [-1, -1, -1, 1, 1, 1],
            sourceCount: 200_000,
            sampleCount: 50_000,
            children: [],
            leafPageCount: 1,
          },
        ])
      ),
    };
    session.selected = Array.from({ length: 20 }, (_, index) => `leaf:${index}:0`);
    (manager as any).requestMissing(session);

    const request = messages.find(message => message.type === 'progressivePly:requestTiles');
    expect(request).toBeTruthy();
    expect(request.tileIds.length).toBeLessThanOrEqual(8);
    const estimatedBytes = request.tileIds.length * 200_000 * 39;
    // A single oversized tile is allowed through, but a normal batch is capped
    // at roughly 32 MiB rather than queueing all selected leaves.
    expect(estimatedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);

    manager.dispose();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  }
});
