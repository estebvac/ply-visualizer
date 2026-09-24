import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  estimateProgressiveDecodedBytes,
  probeProgressivePly,
  shouldUseProgressivePly,
} from '../../providerHandlers/progressivePly';
import { loadDocumentContent } from '../../providerHandlers/documentLoader';

function writeBinaryPly(filePath: string, vertexCount = 4, faceCount = 0): void {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'property float intensity',
    `element face ${faceCount}`,
    'property list uchar int vertex_indices',
    'end_header',
    '',
  ].join('\n');
  const stride = 19;
  const body = Buffer.alloc(vertexCount * stride);
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * stride;
    body.writeFloatLE(i + 0.25, offset);
    body.writeFloatLE(i + 1.25, offset + 4);
    body.writeFloatLE(i + 2.25, offset + 8);
    body[offset + 12] = i * 10;
    body[offset + 13] = i * 20;
    body[offset + 14] = i * 30;
    body.writeFloatLE(i / 10, offset + 15);
  }
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(header, 'latin1'), body]));
}

suite('Progressive PLY routing', () => {
  test('probes fixed-width binary PLY without reading the body into memory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-probe-'));
    const file = path.join(dir, 'cloud.ply');
    writeBinaryPly(file, 12);
    try {
      const probe = await probeProgressivePly(vscode.Uri.file(file));
      assert.strictEqual(probe.encoding, 'binary_little_endian');
      assert.strictEqual(probe.vertexCount, 12);
      assert.strictEqual(probe.faceCount, 0);
      assert.strictEqual(probe.vertexStride, 19);
      assert.strictEqual(probe.hasColors, true);
      assert.strictEqual(probe.hasIntensity, true);
      assert.strictEqual(probe.hasNormals, false);
      assert.strictEqual(probe.isGaussianSplat, false);
      assert.ok(probe.headerBytes < fs.statSync(file).size);
      assert.strictEqual(estimateProgressiveDecodedBytes(probe), 12 * (12 + 3 + 4));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('routing is based on source or decoded memory and excludes mesh PLYs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-route-'));
    const cloud = path.join(dir, 'cloud.ply');
    const mesh = path.join(dir, 'mesh.ply');
    writeBinaryPly(cloud, 100);
    writeBinaryPly(mesh, 100, 1);
    try {
      const cloudProbe = await probeProgressivePly(vscode.Uri.file(cloud));
      const meshProbe = await probeProgressivePly(vscode.Uri.file(mesh));
      assert.strictEqual(
        shouldUseProgressivePly(cloudProbe, 1024, {
          enabled: true,
          fileSizeThresholdBytes: 512,
          decodedMemoryThresholdBytes: Number.MAX_SAFE_INTEGER,
        }),
        true
      );
      assert.strictEqual(
        shouldUseProgressivePly(cloudProbe, 1024, {
          enabled: false,
          fileSizeThresholdBytes: 1,
          decodedMemoryThresholdBytes: 1,
        }),
        false
      );
      assert.strictEqual(
        shouldUseProgressivePly(meshProbe, 1024 * 1024 * 1024, {
          enabled: true,
          fileSizeThresholdBytes: 1,
          decodedMemoryThresholdBytes: 1,
        }),
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('document loader never enters ultimateRawBinaryUri when progressive routing accepts PLY', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ply-progressive-doc-'));
    const file = path.join(dir, 'cloud.ply');
    writeBinaryPly(file, 4);
    const messages: any[] = [];
    let progressiveCalls = 0;
    const host: any = {
      getShortPath: (value: string) => path.basename(value),
      logPerf: () => undefined,
      getCurrentLoadStartedAt: () => Date.now(),
      tryAutoLoadMtl: async () => undefined,
      getSceneMetadata: async () => null,
      startProgressivePly: async () => {
        progressiveCalls++;
        return true;
      },
    };
    const panel = {
      webview: {
        postMessage: async (message: any) => {
          messages.push(message);
          return true;
        },
      },
    } as unknown as vscode.WebviewPanel;
    try {
      await loadDocumentContent(host, vscode.Uri.file(file), panel, {
        fileType: { extension: 'ply', category: 'pointCloud' },
        isDepthFile: false,
        isPfmFile: false,
        isNpyFile: false,
        isPngFile: false,
        isExrFile: false,
        isNpyPointCloud: false,
        isObjFile: false,
        isStlFile: false,
        isPcdFile: false,
        isPtsFile: false,
        isKittiBinFile: false,
        isStonexX3aFile: false,
        isOffFile: false,
        isGltfFile: false,
        isVolumeFile: false,
        isXyzVariant: false,
        isJsonFile: false,
        isLidarFile: false,
        isSplatContainerFile: false,
      });
      assert.strictEqual(progressiveCalls, 1);
      assert.strictEqual(messages.some(message => message.type === 'ultimateRawBinaryUri'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
