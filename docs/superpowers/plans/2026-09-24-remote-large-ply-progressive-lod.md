# Remote Large PLY + Progressive LOD Implementation Plan

**Date:** 2026-09-24  
**Branch:** `feature/remote-large-ply-progressive-lod`

## Goal

Open 1 GB+ ordinary PLY point clouds over VS Code Remote-SSH without making local RAM proportional to the source file size. Source I/O, parsing/index construction, and persistent LOD cache stay in the workspace extension host. The local webview receives only a bounded preview and camera-selected LOD tiles.

## Scope

The first production path targets fixed-stride binary PLY point clouds (little- and big-endian), with no faces and no Gaussian-splat schema. Small files keep the existing direct-fetch/WASM path. Mesh PLYs, splat PLYs, variable-width vertex records, and ASCII PLYs remain on their existing loaders until a dedicated progressive implementation exists for those formats.

## Architecture

```
Remote workspace extension host              Local VS Code webview
--------------------------------             ----------------------
source.ply
  -> bounded header probe
  -> progressive routing
  -> bounded streaming preview -----------> coarse point cloud
  -> remote octree/cache build
  -> persistent globalStorage cache
  <- camera-selected tile IDs ------------- frustum/SSE selector
  -> bounded typed-array tiles -----------> local LRU + point budget
                                             -> Three.js points
                                             -> existing voxel view
```

The complete source PLY must never be fetched into the webview in progressive mode.

## Implementation

1. Add a header-only routing gate before `ultimateRawBinaryUri`.
   - Default source threshold: 256 MiB.
   - Default estimated decoded threshold: 512 MiB.
   - Reject meshes, Gaussian splats, ASCII, and variable-width vertex records.
   - Accept `file` and `vscode-remote` workspace URIs.

2. Force the extension to run as a workspace extension.
   - `extensionKind: ["workspace"]`.
   - Use the remote `fsPath` for bounded Node file reads.
   - Store cache under remote `globalStorageUri`.

3. Build a deterministic remote preview.
   - Read source vertices in bounded chunks.
   - Compute exact bounds while scanning.
   - Use the first source point as local origin for floating-point precision.
   - Send an early preview before the full first pass completes.
   - Cap preview point count from the configured local memory budget.

4. Build the persistent remote LOD cache.
   - Second bounded streaming pass.
   - Spatial octree assignment.
   - Leaf source pages plus deterministic representative LOD samples.
   - Preserve RGB, normals, intensity, and scalar attributes.
   - Cache identity includes path, size, mtime, and header bytes.
   - Build in a temporary directory and atomically publish the manifest/cache.
   - Cancel and remove incomplete caches when the panel closes.
   - Cap active leaf buffers and queued write bytes.

5. Add the extension/webview protocol.
   - `progressivePly:start`
   - `progressivePly:preview`
   - `progressivePly:progress`
   - `progressivePly:ready`
   - `progressivePly:requestTiles`
   - `progressivePly:tile`
   - `progressivePly:tileError`
   - `progressivePly:error`
   - `progressivePly:panelVisibility`

6. Add the local progressive manager.
   - Frustum and projected-size LOD selection.
   - Generation IDs so stale camera requests are ignored.
   - Configurable visible-point budget.
   - Configurable local memory budget.
   - LRU tile eviction.
   - Request bursts bounded by both tile count and estimated bytes.
   - Point budget automatically reduced for wide schemas.
   - Reserve memory for current geometry, replacement geometry, and tile cache.

7. Integrate with existing viewer semantics.
   - Initial open uses `displayFiles`.
   - Add-file/drag-drop uses `addNewFiles` without refitting existing scenes.
   - Preserve source-origin alignment across LOD replacements.
   - Preserve color modes and scalar attributes.
   - Rebuild the existing voxelized representation from the currently resident LOD payload.
   - Keep small-file behavior unchanged.

8. Release memory when hidden.
   - Stop fine LOD refinement.
   - Collapse the retained webview to root/coarse LOD.
   - Drop fine tile cache while preserving fast restore.

## Verification

TDD/CI coverage must include:

- Little-endian fixed-stride PLY header/routing.
- Big-endian fixed-stride PLY decoding.
- Binary body beginning with CR/LF bytes.
- Remote-SSH URI routing.
- Mesh/ASCII/splat/variable-width rejection.
- Preview point and attribute fidelity.
- Persistent root/leaf cache reads.
- Cancellation and incomplete-cache cleanup.
- Local point-budget derivation from memory budget and bytes-per-point.
- Bounded tile-request bursts.
- Existing small PLY path and viewer regressions.
- VS Code extension build/type-check/unit tests and VSIX packaging.

## Acceptance

For a 1 GB+ binary point-cloud PLY opened through Remote-SSH:

- no full-file `fetch()` occurs in the webview;
- no source-sized local WASM input allocation occurs;
- a coarse preview becomes visible while remote indexing continues;
- local resident point payload stays within configured bounded budgets;
- camera movement progressively refines visible regions;
- hiding the editor releases fine LOD data;
- reopening the same unchanged source reuses the remote persistent cache;
- point colors/scalars and the voxelized view remain functional.
