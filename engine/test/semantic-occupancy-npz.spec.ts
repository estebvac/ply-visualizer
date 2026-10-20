import { expect, test } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';

/** Small in-memory NPY/ZIP fixture: no NumPy, Python, or external packages. */
function npy(dtype: string, shape: number[], values: Buffer): Buffer {
  const dims = shape.length === 1 ? String(shape[0]) + ',' : shape.join(', ');
  const dict = "{'descr': '" + dtype + "', 'fortran_order': False, 'shape': (" + dims + "), }";
  const pad = (16 - ((10 + dict.length + 1) % 16)) % 16;
  const header = Buffer.from(dict + ' '.repeat(pad) + '\n');
  const prefix = Buffer.alloc(10);
  Buffer.from([0x93, 78, 85, 77, 80, 89, 1, 0]).copy(prefix);
  prefix.writeUInt16LE(header.length, 8);
  return Buffer.concat([prefix, header, values]);
}

function numeric<T extends number | bigint>(
  items: T[], width: number, write: (buffer: Buffer, value: T, offset: number) => void
): Buffer {
  const b = Buffer.alloc(items.length * width);
  items.forEach((value, i) => write(b, value, i * width));
  return b;
}

function crc32(b: Buffer): number {
  let value = 0xffffffff;
  for (const byte of b) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (-(value & 1) & 0xedb88320);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function npz(files: Array<[string, Buffer]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [key, data] of files) {
    const name = Buffer.from(key + '.npy');
    const zipped = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8); // ZIP deflate, matching np.savez_compressed
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(zipped.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, zipped);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(zipped.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + zipped.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

const i64 = (x: bigint[]) => numeric(x, 8, (b, v, o) => b.writeBigInt64LE(v, o));
const i32 = (x: number[]) => numeric(x, 4, (b, v, o) => b.writeInt32LE(v, o));
const f64 = (x: number[]) => numeric(x, 8, (b, v, o) => b.writeDoubleLE(v, o));

function occupancyArchive(): Buffer {
  // First voxel index is > 2^24: converting to float32 before unflattening
  // would move it to a different voxel.
  return npz([
    ['sparse_linear_indices', npy('<i8', [3], i64([16777217n, 16777218n, 16777225n]))],
    ['sparse_labels', npy('<i4', [3], i32([7, 255, 7]))],
    ['sparse_grid_shape', npy('<i8', [3], i64([1000n, 1000n, 30n]))],
    ['voxel_size_m', npy('<f8', [1], f64([0.2]))],
    ['pc_range_m', npy('<f8', [6], f64([-100, -100, 0, 100, 100, 6]))],
    ['unknown_label', npy('<i4', [1], i32([255]))],
    ['semantic_palette_ids', npy('<i4', [2], i32([7, 255]))],
    ['semantic_palette_rgb', npy('|u1', [2, 3], Buffer.from([255, 230, 80, 64, 64, 64]))],
    ['semantic_palette_schema_version', npy('<u2', [1], Buffer.from([1, 0]))],
  ]);
}

test('colored semantic NPZ opens as two points without requesting depth calibration', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#three-canvas');
  await page.locator('#hiddenFileInput').setInputFiles({
    name: 'semantic-occupancy.npz',
    mimeType: 'application/zip',
    buffer: occupancyArchive(),
  });
  await expect(page.locator('#file-list .file-item')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('#depth-ok')).toHaveCount(0);
  const result = await page.evaluate(() => {
    const cloud = (window as any).visualizer.spatialFiles[0];
    return {
      count: cloud.vertexCount,
      colors: Array.from(cloud.colorsArray as Uint8Array),
      positions: Array.from(cloud.positionsArray as Float32Array),
      semantic: Array.from(cloud.scalarFields.semantic_label as Float32Array),
      unknown: cloud.metadata.unknown_voxel_count,
    };
  });
  expect(result.count).toBe(2);
  expect(result.colors).toEqual([255, 230, 80, 255, 230, 80]);
  expect(result.semantic).toEqual([7, 7]);
  expect(result.unknown).toBe(1);
  const point = (linear: number) => [
    -100 + (Math.floor(linear / 30000) + 0.5) * 0.2,
    -100 + (Math.floor(linear / 30) % 1000 + 0.5) * 0.2,
    ((linear % 30) + 0.5) * 0.2,
  ];
  expect(result.positions[0]).toBeCloseTo(point(16777217)[0], 4);
  expect(result.positions[1]).toBeCloseTo(point(16777217)[1], 4);
  expect(result.positions[2]).toBeCloseTo(point(16777217)[2], 4);
  expect(result.positions[5]).toBeCloseTo(point(16777225)[2], 4);
});

test('an ordinary compressed depth NPZ still requests camera calibration', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#three-canvas');
  await page.locator('#hiddenFileInput').setInputFiles({
    name: 'depth.npz',
    mimeType: 'application/zip',
    buffer: npz([
      ['depth', npy('<f4', [2, 2], numeric([1, 2, 3, 4], 4,
        (b, v, o) => b.writeFloatLE(v, o)))],
    ]),
  });
  await expect(page.locator('#depth-ok')).toBeVisible({ timeout: 30_000 });
});
