#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const gib = Number(argument('gib', '1'));
const output = path.resolve(argument('out', 'progressive-large-test.ply'));
if (!Number.isFinite(gib) || gib <= 0) {
  throw new Error('--gib must be a positive number');
}

const stride = 15; // float32 XYZ + uint8 RGB
const targetBytes = Math.floor(gib * 1024 ** 3);

function makeHeader(pointCount) {
  return Buffer.from(
    [
      'ply',
      'format binary_little_endian 1.0',
      'comment generated progressive-PLY stress fixture',
      `element vertex ${pointCount}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'element face 0',
      'property list uchar int vertex_indices',
      'end_header',
      '',
    ].join('\n'),
    'ascii'
  );
}

let pointCount = Math.max(1, Math.floor((targetBytes - 512) / stride));
for (;;) {
  const header = makeHeader(pointCount);
  const next = Math.max(1, Math.floor((targetBytes - header.byteLength) / stride));
  if (next === pointCount) break;
  pointCount = next;
}
const header = makeHeader(pointCount);

const templatePoints = Math.min(pointCount, 262_144);
const template = Buffer.allocUnsafe(templatePoints * stride);
for (let i = 0; i < templatePoints; i++) {
  const offset = i * stride;
  const x = (i % 512) * 0.05;
  const y = (Math.floor(i / 512) % 512) * 0.05;
  const z = ((i * 17) % 2048) * 0.01;
  template.writeFloatLE(x, offset);
  template.writeFloatLE(y, offset + 4);
  template.writeFloatLE(z, offset + 8);
  template[offset + 12] = i & 0xff;
  template[offset + 13] = (i * 3) & 0xff;
  template[offset + 14] = (i * 7) & 0xff;
}

await fs.promises.mkdir(path.dirname(output), { recursive: true });
const handle = await fs.promises.open(output, 'w');
try {
  await handle.write(header);
  let remaining = pointCount;
  let written = header.byteLength;
  const reportEvery = 256 * 1024 * 1024;
  let nextReport = reportEvery;
  while (remaining > 0) {
    const count = Math.min(remaining, templatePoints);
    const bytes = count * stride;
    await handle.write(template, 0, bytes);
    remaining -= count;
    written += bytes;
    if (written >= nextReport || remaining === 0) {
      process.stdout.write(
        `\r${(written / 1024 ** 3).toFixed(2)} GiB written (${(
          ((pointCount - remaining) / pointCount) *
          100
        ).toFixed(1)}%)`
      );
      nextReport += reportEvery;
    }
  }
  process.stdout.write('\n');
} finally {
  await handle.close();
}

const finalBytes = (await fs.promises.stat(output)).size;
console.log(
  `Created ${output}\n` +
    `  points: ${pointCount.toLocaleString()}\n` +
    `  bytes:  ${finalBytes.toLocaleString()} (${(finalBytes / 1024 ** 3).toFixed(3)} GiB)\n` +
    `  schema: binary_little_endian XYZ float32 + RGB uint8`
);
