import { expect, test } from '@playwright/test';
import { decodeProgressiveTile, type ProgressiveManifest } from '../src/progressivePlyClient';

test('progressive tile decoder preserves packed attributes without source-sized allocation', () => {
  const stride = 12 + 3 + 12 + 4 + 4;
  const raw = new ArrayBuffer(stride * 2);
  const view = new DataView(raw);
  const bytes = new Uint8Array(raw);

  const write = (index: number, base: number) => {
    let offset = index * stride;
    view.setFloat32(offset, base + 1, true);
    view.setFloat32(offset + 4, base + 2, true);
    view.setFloat32(offset + 8, base + 3, true);
    offset += 12;
    bytes[offset++] = 10 + base;
    bytes[offset++] = 20 + base;
    bytes[offset++] = 30 + base;
    view.setFloat32(offset, base + 4, true);
    view.setFloat32(offset + 4, base + 5, true);
    view.setFloat32(offset + 8, base + 6, true);
    offset += 12;
    view.setFloat32(offset, base + 7, true);
    offset += 4;
    view.setFloat32(offset, base + 8, true);
  };
  write(0, 0);
  write(1, 10);

  const manifest = {
    version: 1,
    complete: true,
    rootId: 'root',
    gridResolution: 2,
    depth: 1,
    nodes: [],
    bbox: [0, 0, 0, 1, 1, 1],
    schema: {
      recordStride: stride,
      hasColors: true,
      hasNormals: true,
      hasIntensity: true,
      scalarNames: ['quality'],
    },
  } satisfies ProgressiveManifest;

  const decoded = decodeProgressiveTile(raw, manifest);
  expect(Array.from(decoded.positions)).toEqual([1, 2, 3, 11, 12, 13]);
  expect(Array.from(decoded.colors ?? [])).toEqual([10, 20, 30, 20, 30, 40]);
  expect(Array.from(decoded.normals ?? [])).toEqual([4, 5, 6, 14, 15, 16]);
  expect(Array.from(decoded.intensity ?? [])).toEqual([7, 17]);
  expect(Array.from(decoded.scalars.quality)).toEqual([8, 18]);
});
