import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProgressivePlyHeader } from '../../progressivePly/header';
import {
  acceptProgressiveGeneration,
  isCurrentProgressiveGeneration,
} from '../../progressivePly/generation';
import {
  estimateDecodedPlyBytes,
  shouldUseProgressivePly,
  supportsProgressivePlyUri,
} from '../../progressivePly/routing';
import {
  buildProgressiveCache,
  buildProgressivePreview,
  readProgressiveTile,
} from '../../progressivePly/cache';

function makeBigEndianBinaryPly(pointCount = 64): Buffer {
  const header = Buffer.from(
    [
      'ply',
      'format binary_big_endian 1.0',
      'comment progressive-big-endian-test',
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
  const stride = 15;
  const body = Buffer.alloc(pointCount * stride);
  for (let i = 0; i < pointCount; i++) {
    const offset = i * stride;
    body.writeFloatBE(i + 0.25, offset);
    body.writeFloatBE(i * 2 + 0.5, offset + 4);
    body.writeFloatBE(-i - 0.75, offset + 8);
    body[offset + 12] = i % 256;
    body[offset + 13] = (i * 2) % 256;
    body[offset + 14] = (i * 3) % 256;
  }
  return Buffer.concat([header, body]);
}

function makeBinaryPly(pointCount = 2048): Buffer {
  const header = Buffer.from(
    [
      'ply',
      'format binary_little_endian 1.0',
      'comment progressive-test',
      `element vertex ${pointCount}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'property float intensity',
      'element face 0',
      'property list uchar int vertex_indices',
      'end_header',
      '',
    ].join('\n'),
    'ascii'
  );
  const stride = 19;
  const body = Buffer.alloc(pointCount * stride);
  for (let i = 0; i < pointCount; i++) {
    const offset = i * stride;
    body.writeFloatLE(i % 32, offset);
    body.writeFloatLE(Math.floor(i / 32) % 32, offset + 4);
    body.writeFloatLE(i / pointCount, offset + 8);
    body[offset + 12] = i % 256;
    body[offset + 13] = (i * 3) % 256;
    body[offset + 14] = (i * 7) % 256;
    body.writeFloatLE(i / 10, offset + 15);
  }
  return Buffer.concat([header, body]);
}

suite('Progressive PLY remote loading', () => {
  test('rejects stale camera generations before remote tile work', () => {
    const state = { latestGeneration: -1 };
    assert.strictEqual(acceptProgressiveGeneration(state, 0), true);
    assert.strictEqual(state.latestGeneration, 0);
    assert.strictEqual(acceptProgressiveGeneration(state, 3), true);
    assert.strictEqual(state.latestGeneration, 3);
    assert.strictEqual(acceptProgressiveGeneration(state, 2), false);
    assert.strictEqual(state.latestGeneration, 3);
    assert.strictEqual(acceptProgressiveGeneration(state, Number.NaN), false);
    assert.strictEqual(isCurrentProgressiveGeneration(state, 3), true);
    assert.strictEqual(isCurrentProgressiveGeneration(state, 2), false);
  });

  test('parses fixed-stride binary PLY schema and routes by memory budget', () => {
    const bytes = makeBinaryPly(100);
    const header = parseProgressivePlyHeader(bytes);
    assert.strictEqual(header.format, 'binary_little_endian');
    assert.strictEqual(header.vertexStride, 19);
    assert.strictEqual(header.vertexCount, 100);
    assert.strictEqual(header.faceCount, 0);
    assert.strictEqual(header.hasColors, true);
    assert.strictEqual(header.hasIntensity, true);
    assert.deepStrictEqual(header.scalarFieldNames, []);

    const routingHeader = {
      format: header.format,
      vertexCount: header.vertexCount,
      faceCount: header.faceCount,
      hasColors: header.hasColors,
      hasNormals: header.hasNormals,
      hasIntensity: header.hasIntensity,
      scalarFieldNames: header.scalarFieldNames,
      isGaussianSplat: header.isGaussianSplat,
      fixedVertexStride: header.vertexStride,
      vertexDataStartsAtBody: header.vertexDataStartsAtBody,
    };
    assert.strictEqual(estimateDecodedPlyBytes(routingHeader), 100 * 19);
    assert.strictEqual(
      shouldUseProgressivePly(bytes.length, routingHeader, {
        fileSizeThresholdBytes: 1,
        decodedBytesThresholdBytes: Number.MAX_SAFE_INTEGER,
      }),
      true
    );
  });

  test('rejects meshes, ASCII files, and Gaussian splats from progressive routing', () => {
    const base = {
      format: 'binary_little_endian' as const,
      vertexCount: 1000,
      faceCount: 0,
      hasColors: true,
      hasNormals: false,
      hasIntensity: false,
      scalarFieldNames: [] as string[],
      isGaussianSplat: false,
      fixedVertexStride: 15,
      vertexDataStartsAtBody: true,
    };
    const force = { fileSizeThresholdBytes: 1, decodedBytesThresholdBytes: 1 };
    assert.strictEqual(shouldUseProgressivePly(1024, { ...base, faceCount: 1 }, force), false);
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, format: 'ascii' as const }, force),
      false
    );
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, isGaussianSplat: true }, force),
      false
    );
  });

  test('rejects non-finite coordinates before building LOD bounds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-nonfinite-'));
    const filePath = path.join(dir, 'nonfinite.ply');
    const bytes = makeBinaryPly(4);
    const header = parseProgressivePlyHeader(bytes);
    bytes.writeFloatLE(Number.NaN, header.headerBytes);
    fs.writeFileSync(filePath, bytes);
    try {
      await assert.rejects(
        () =>
          buildProgressivePreview(filePath, header, {
            previewPoints: 4,
            tilePoints: 4,
            lodSamplePoints: 2,
            maxDepth: 2,
            chunkBytes: 64,
          }),
        /non-finite x\/y\/z coordinate/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('decodes big-endian fixed-stride PLY previews correctly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-be-'));
    const filePath = path.join(dir, 'big-endian.ply');
    fs.writeFileSync(filePath, makeBigEndianBinaryPly(64));
    try {
      const probe = fs.readFileSync(filePath).subarray(0, 4096);
      const header = parseProgressivePlyHeader(probe);
      assert.strictEqual(header.format, 'binary_big_endian');
      assert.strictEqual(header.littleEndian, false);
      assert.strictEqual(header.vertexStride, 15);
      const preview = await buildProgressivePreview(filePath, header, {
        previewPoints: 64,
        tilePoints: 32,
        lodSamplePoints: 16,
        maxDepth: 3,
        chunkBytes: 128,
      });
      assert.strictEqual(preview.preview.count, 64);
      // Positions are stored relative to the first source point.
      assert.ok(Math.abs(preview.preview.positions[0]) < 1e-6);
      assert.ok(Math.abs(preview.preview.positions[1]) < 1e-6);
      assert.ok(Math.abs(preview.preview.positions[2]) < 1e-6);
      assert.ok(Math.abs(preview.preview.positions[3] - 1) < 1e-6);
      assert.ok(Math.abs(preview.preview.positions[4] - 2) < 1e-6);
      assert.ok(Math.abs(preview.preview.positions[5] + 1) < 1e-6);
      assert.deepStrictEqual(Array.from(preview.preview.colors!.slice(0, 6)), [0, 0, 0, 1, 2, 3]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not consume binary body bytes that happen to equal CR/LF', () => {
    const headerBytes = Buffer.from(
      [
        'ply',
        'format binary_little_endian 1.0',
        'element vertex 1',
        'property float x',
        'property float y',
        'property float z',
        'element face 0',
        'property list uchar int vertex_indices',
        'end_header',
        '',
      ].join('\n'),
      'ascii'
    );
    const body = Buffer.alloc(12);
    body[0] = 0x0a;
    body[1] = 0x0d;
    const parsed = parseProgressivePlyHeader(Buffer.concat([headerBytes, body]));
    assert.strictEqual(parsed.headerBytes, headerBytes.byteLength);
  });

  test('routes Remote-SSH PLY URIs to the remote progressive path', () => {
    assert.strictEqual(
      supportsProgressivePlyUri({
        scheme: 'vscode-remote',
        fsPath: '/remote/workspace/cloud.ply',
      }),
      true
    );
    assert.strictEqual(
      supportsProgressivePlyUri({ scheme: 'file', fsPath: '/tmp/cloud.PLY' }),
      true
    );
    assert.strictEqual(
      supportsProgressivePlyUri({ scheme: 'untitled', fsPath: '/tmp/cloud.ply' }),
      false
    );
  });

  test('rejects a PLY whose vertex records do not start at the binary body', () => {
    const headerBytes = Buffer.from(
      [
        'ply',
        'format binary_little_endian 1.0',
        'element metadata 1',
        'property int id',
        'element vertex 2',
        'property float x',
        'property float y',
        'property float z',
        'element face 0',
        'property list uchar int vertex_indices',
        'end_header',
        '',
      ].join('\n'),
      'ascii'
    );
    const parsed = parseProgressivePlyHeader(headerBytes);
    assert.strictEqual(parsed.vertexDataStartsAtBody, false);
    assert.strictEqual(
      shouldUseProgressivePly(
        1024 * 1024 * 1024,
        {
          format: parsed.format,
          vertexCount: parsed.vertexCount,
          faceCount: parsed.faceCount,
          hasColors: parsed.hasColors,
          hasNormals: parsed.hasNormals,
          hasIntensity: parsed.hasIntensity,
          scalarFieldNames: parsed.scalarFieldNames,
          isGaussianSplat: parsed.isGaussianSplat,
          fixedVertexStride: parsed.vertexStride,
          vertexDataStartsAtBody: parsed.vertexDataStartsAtBody,
        },
        { fileSizeThresholdBytes: 1, decodedBytesThresholdBytes: 1 }
      ),
      false
    );
  });

  test('keeps meshes, ASCII clouds, splats, and variable-width vertices off the progressive path', () => {
    const base = {
      format: 'binary_little_endian' as const,
      vertexCount: 10_000_000,
      faceCount: 0,
      hasColors: true,
      hasNormals: false,
      hasIntensity: false,
      scalarFieldNames: [] as string[],
      isGaussianSplat: false,
      fixedVertexStride: 15,
      vertexDataStartsAtBody: true,
    };
    const force = { fileSizeThresholdBytes: 1, decodedBytesThresholdBytes: 1 };
    assert.strictEqual(shouldUseProgressivePly(1024, base, force), true);
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, format: 'ascii' }, force),
      false
    );
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, faceCount: 1 }, force),
      false
    );
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, isGaussianSplat: true }, force),
      false
    );
    assert.strictEqual(
      shouldUseProgressivePly(1024, { ...base, fixedVertexStride: null }, force),
      false
    );
  });

  test('builds preview and persistent LOD tiles without loading the whole file into webview memory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-'));
    const filePath = path.join(dir, 'large.ply');
    const cacheDir = path.join(dir, 'cache');
    fs.writeFileSync(filePath, makeBinaryPly(4096));
    try {
      const probe = fs.readFileSync(filePath).subarray(0, 4096);
      const header = parseProgressivePlyHeader(probe);
      const options = {
        previewPoints: 128,
        tilePoints: 64,
        lodSamplePoints: 32,
        maxDepth: 4,
        chunkBytes: 4096,
      };
      const preview = await buildProgressivePreview(filePath, header, options);
      assert.ok(preview.preview.count <= 128);
      assert.strictEqual(preview.preview.colors?.length, preview.preview.count * 3);
      assert.strictEqual(preview.preview.intensity?.length, preview.preview.count);
      assert.ok(preview.bounds[3] >= 31);
      assert.ok(preview.bounds[4] >= 31);

      const stat = fs.statSync(filePath);
      const manifest = await buildProgressiveCache(
        filePath,
        cacheDir,
        header,
        { size: stat.size, mtime: stat.mtimeMs },
        preview,
        options
      );
      assert.strictEqual(manifest.source.vertexCount, 4096);
      assert.ok(manifest.nodes['']);
      assert.ok(manifest.nodes[''].sampleCount <= options.lodSamplePoints);
      assert.ok(Object.values(manifest.nodes).some(node => node.leafPageCount > 0));

      const root = await readProgressiveTile(cacheDir, manifest, 'node:');
      assert.ok(root.count > 0);
      assert.ok(root.count <= options.lodSamplePoints);
      assert.strictEqual(root.positions.length, root.count * 3);

      const leaf = Object.values(manifest.nodes).find(node => node.leafPageCount > 0)!;
      const page = await readProgressiveTile(cacheDir, manifest, `leaf:${leaf.id}:0`);
      assert.ok(page.count > 0);
      assert.ok(page.count <= options.tilePoints);
      assert.strictEqual(page.colors?.length, page.count * 3);
      assert.strictEqual(page.intensity?.length, page.count);

      await assert.rejects(
        () => readProgressiveTile(cacheDir, manifest, 'node:../../outside'),
        /Unknown progressive PLY node tile/
      );
      await assert.rejects(
        () => readProgressiveTile(cacheDir, manifest, 'leaf:../../outside:0'),
        /Unknown leaf tile/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cleans incomplete cache directories when cancelled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-cancel-'));
    const filePath = path.join(dir, 'large.ply');
    const cacheDir = path.join(dir, 'cache');
    fs.writeFileSync(filePath, makeBinaryPly(4096));
    try {
      const header = parseProgressivePlyHeader(fs.readFileSync(filePath).subarray(0, 4096));
      const options = {
        previewPoints: 64,
        tilePoints: 64,
        lodSamplePoints: 32,
        maxDepth: 4,
        chunkBytes: 1024,
      };
      const preview = await buildProgressivePreview(filePath, header, options);
      const stat = fs.statSync(filePath);
      await assert.rejects(
        () =>
          buildProgressiveCache(
            filePath,
            cacheDir,
            header,
            { size: stat.size, mtime: stat.mtimeMs },
            preview,
            options,
            undefined,
            () => true
          ),
        /cancelled/
      );
      assert.strictEqual(fs.existsSync(cacheDir), false);
      assert.strictEqual(
        fs.readdirSync(dir).some(name => name.startsWith('cache.tmp-')),
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cleans an incomplete cache when progressive indexing is cancelled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-cancel-'));
    const filePath = path.join(dir, 'cancel.ply');
    const cacheDir = path.join(dir, 'cache');
    fs.writeFileSync(filePath, makeBinaryPly(20_000));
    try {
      const probe = fs.readFileSync(filePath).subarray(0, 4096);
      const header = parseProgressivePlyHeader(probe);
      const options = {
        previewPoints: 128,
        tilePoints: 128,
        lodSamplePoints: 32,
        maxDepth: 4,
        chunkBytes: 2048,
      };
      const preview = await buildProgressivePreview(filePath, header, options);
      const stat = fs.statSync(filePath);
      let cancelled = false;
      await assert.rejects(
        () =>
          buildProgressiveCache(
            filePath,
            cacheDir,
            header,
            { size: stat.size, mtime: stat.mtimeMs },
            preview,
            options,
            (phase, fraction) => {
              if (phase === 'index' && fraction > 0) cancelled = true;
            },
            () => cancelled
          ),
        /cancelled/
      );
      assert.strictEqual(fs.existsSync(cacheDir), false);
      assert.deepStrictEqual(
        fs.readdirSync(dir).filter(name => name.startsWith('cache.tmp-')),
        []
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('does not publish a cache if the source PLY changes during indexing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-stale-'));
    const filePath = path.join(dir, 'changing.ply');
    const cacheDir = path.join(dir, 'cache');
    fs.writeFileSync(filePath, makeBinaryPly(8_000));
    try {
      const header = parseProgressivePlyHeader(fs.readFileSync(filePath).subarray(0, 4096));
      const options = {
        previewPoints: 128,
        tilePoints: 128,
        lodSamplePoints: 32,
        maxDepth: 4,
        chunkBytes: 2048,
      };
      const preview = await buildProgressivePreview(filePath, header, options);
      const stat = fs.statSync(filePath);
      let touched = false;
      await assert.rejects(
        () =>
          buildProgressiveCache(
            filePath,
            cacheDir,
            header,
            { size: stat.size, mtime: stat.mtimeMs },
            preview,
            options,
            (phase, fraction) => {
              if (!touched && phase === 'index' && fraction > 0.25) {
                touched = true;
                const changed = new Date(Date.now() + 5_000);
                fs.utimesSync(filePath, changed, changed);
              }
            }
          ),
        /changed while progressive cache was being built/
      );
      assert.strictEqual(fs.existsSync(cacheDir), false);
      assert.strictEqual(
        fs.readdirSync(dir).some(name => name.startsWith('cache.tmp-')),
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});
