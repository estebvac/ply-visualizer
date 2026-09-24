# Remote files

Requires **VS Code 1.106.0 or later** (Node 22.20.0).

Run **3D Visualizer: Load Remote URL** from the VS Code command palette. Paste
an HTTP(S) link to a supported file. Press Up/Down or click the arrow buttons to
recall previously loaded URLs. The latest 50 distinct URLs are saved across
sessions. The entire file downloads before visualization; VS Code keeps
downloads in its extension storage.

Gzip (`.gz`), zlib (`.zlib`, `.zz`, `.deflate`), raw DEFLATE (`.deflate-raw`),
and Brotli (`.br`, `.brotli`) files are decompressed using built-in APIs, with
no additional library. Gzip and zlib are also recognized by their headers.
Website Brotli loading requires a browser with Brotli support in
`DecompressionStream`. For URLs without a recognizable filename, supply a
filename with the correct extension when prompted.

Website links use `?source=<encoded-file-url>` to reopen a remote file; an
optional `filename` parameter selects its format. There is no remote URL button
in the viewer. The source server must allow browser CORS requests. Use
self-contained files (for example GLB) for easy sharing. GLTF/GLB, FBX, Collada
and 3DS supporting buffers and textures are resolved relative to the model URL;
each resource must also allow CORS.


## VS Code Remote-SSH large PLY files

Large ordinary binary PLY point clouds opened from a Remote-SSH workspace use a
different path from **Load Remote URL**. The extension runs as a workspace
extension on the SSH host, reads the source there, and keeps the full PLY and its
persistent LOD cache remote. The local VS Code webview receives only a bounded
preview plus camera-selected LOD tiles.

The progressive path currently applies to fixed-stride binary little- or
big-endian PLY point clouds with no faces and no Gaussian-splat schema. Mesh PLY,
ASCII PLY, splat PLY and variable-width vertex records continue to use their
existing loaders.

By default progressive loading starts when either the source PLY is at least
256 MiB or its decoded point arrays are estimated at 512 MiB or more. Configure
the behavior under **3D Visualizer > Large PLY**:

- `plyViewer.largePly.progressiveFileSizeMiB` — source-size routing threshold.
- `plyViewer.largePly.progressiveDecodedSizeMiB` — decoded-memory routing threshold.
- `plyViewer.largePly.localMemoryBudgetMiB` — approximate local CPU budget for
  the current payload and reusable tiles.
- `plyViewer.largePly.visiblePointBudget` — desired maximum visible points.
- `plyViewer.largePly.previewPoints` — cap for the first coarse preview.
- `plyViewer.largePly.tilePoints` — maximum source points in one leaf page,
  additionally bounded by the transfer byte cap.
- `plyViewer.largePly.lodSamplePoints` — representative points per LOD node.

The first open scans the remote source to compute exact bounds and a deterministic
preview, then builds an octree cache under the extension's remote global storage.
The preview can appear while that work continues. Reopening an unchanged source
reuses the cache. Cache identity includes source path, file size, modification
time and PLY header bytes.

Camera movement requests only useful nodes. Obsolete camera generations are
cancelled on the extension host before their tiles are sent, and a hidden
retained webview drops fine LOD tiles back to a coarse/root representation.
Point colors, normals, intensity/scalar fields and the point-cloud voxel render
mode are rebuilt from the currently resident LOD payload.

### Remote stress test

A synthetic fixed-stride binary PLY can be generated without allocating a
source-sized buffer:

```bash
node scripts/generate-large-ply.mjs --gib 1.1 --out /tmp/progressive-large-test.ply
```

Open that file through the Remote-SSH Explorer with the 3D Visualizer. For a
progressive load, the complete source file must not be fetched into the local
webview and local memory should stay bounded by the configured resident budgets
rather than scaling with the 1.1 GiB source.
