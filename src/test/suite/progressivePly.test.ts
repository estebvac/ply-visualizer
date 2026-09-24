import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProgressivePlyHeader } from '../../progressivePly/header';
import {
  estimateDecodedPlyBytes,
  shouldUseProgressivePly,
} from '../../progressivePly/routing';
import {
  buildProgressiveCache,
  buildProgressivePreview,
  readProgressiveTile,
} from '../../progressivePly/cache';
import { supportsProgressivePlyUri } from '../../progressivePly/service';

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
});
