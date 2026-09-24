# View Cube Rendering Fix

**Date:** 2026-09-24  
**Branch:** `feature/orbit-pivot-view-cube`  
**Scope:** Fix the malformed ViewCube rendering in the VS Code sidebar while preserving the now-correct Standard Orbit interaction behavior.

## Context

The current ViewCube implementation is functionally connected to camera orientation, but visually it does not render as a coherent cube in the VS Code webview. The observed result is a stack of thin white fragments and overlapping face elements rather than a solid box.

The desired behavior is based on:

- DeSandro CSS 3D cube geometry: https://3dtransforms.desandro.com/cube
- Three.js ViewCube discussion and examples: https://discourse.threejs.org/t/view-cube-box-icon/3479/5

The LMB Orbit behavior is now correct and must not be altered by this work.

## Diagnosis

The current implementation has four structural issues:

1. It writes a raw Three.js `Matrix4.elements` array directly to CSS `matrix3d(...)`. Three.js and CSS matrix conventions are not identical; `CSS3DRenderer` applies sign changes to bridge coordinate systems.
2. Cube faces use `backface-visibility: visible`, so rear faces remain visible through the cube.
3. Edge and corner controls are floating `translate3d(...)` buttons rather than geometry anchored to cube edges/corners.
4. The cube is missing the complete DeSandro-style transform model: face transforms plus the cube's own half-depth translation and rotation ordering.

These problems explain the distorted appearance visible in the VS Code sidebar.

## Design Constraints

- Do not redesign Standard Orbit behavior.
- Preserve +Z world-up.
- Preserve current rotation center / target semantics.
- Preserve target distance during view snaps.
- Preserve animation cancellation behavior.
- Keep legacy Trackball/Arcball behavior unchanged.
- The cube must remain a fixed-size UI gizmo independent of camera distance, FOV, scene scale, or target position.

## Implementation Plan

### 1. Freeze the navigation contract

Keep the following behavior unchanged:

- `CameraViewAnimator`
- `cameraOrientation.ts`
- Standard Orbit +Z world-up
- target-preserving snaps
- LMB orbit
- wheel/MMB zoom
- RMB pan
- double-click pivot
- animation cancellation on direct user navigation

Existing Orbit regression tests remain mandatory.

### 2. Rebuild the ViewCube DOM structure

Refactor `engine/src/components/ViewCube.svelte` around a proper CSS 3D scene:

```
scene
└── cube
    ├── +X face
    ├── -X face
    ├── +Y face
    ├── -Y face
    ├── +Z face
    └── -Z face
```

Use a fixed cube size around 70–80 px inside a fixed scene around 120–140 px.

Each face must use a canonical transform of the form:

- rotate to its axis
- then `translateZ(CUBE_SIZE / 2)`

The cube itself must include a base `translateZ(-CUBE_SIZE / 2)` before orientation rotation, matching the DeSandro model.

### 3. Add a Three.js → CSS transform helper

Create a helper such as:

`engine/src/viewCubeTransform.ts`

Responsibilities:

- convert the current camera quaternion into a CSS-compatible rotation transform;
- follow the same coordinate-sign convention used by Three.js `CSS3DRenderer`;
- remove tiny floating-point noise;
- include rotation only;
- never include camera translation, target position, FOV, dolly distance, or projection.

The ViewCube should consume this helper instead of writing raw Three.js matrix elements directly into `matrix3d(...)`.

### 4. Make axis mapping explicit

Define one shared mapping for:

- +X
- -X
- +Y
- -Y
- +Z
- -Z

and for edge/corner directions.

This mapping must be shared between rendering and camera snap semantics so the ViewCube cannot visually disagree with `cameraOrientation.ts`.

### 5. Hide rear faces correctly

Change cube faces to:

`backface-visibility: hidden`

Rear faces must disappear naturally when turned away from the viewer.

Do not use transparency as a substitute for correct face visibility.

### 6. Remove VS Code button styling from cube geometry

Do not use ordinary styled VS Code buttons as the structural faces.

Use either:

- reset elements with `all: unset`, or
- dedicated semantic elements with controlled styles.

Retain keyboard accessibility using:

- `role="button"`
- `tabindex="0"`
- Enter / Space activation
- accessible labels

This prevents global button styles from distorting the cube geometry.

### 7. Replace floating edge/corner hotspots

Remove the current direction-based floating hotspot transform:

`translate3d(direction * extent)`

Replace it with interaction regions geometrically tied to the cube:

- 6 face-center regions
- 12 narrow edge regions
- 8 corner regions

These interaction targets must rotate with the cube and stay attached to the visible geometry.

### 8. Keep rendering and interaction geometry separate

The visual cube should remain a coherent solid object.

Interaction regions may be transparent overlays, but they must:

- share the same transform hierarchy as the cube;
- never float independently;
- never protrude beyond the cube;
- not alter the visible geometry.

### 9. Camera synchronization

Manual orbit must rotate the ViewCube using camera orientation only.

The following must not alter cube size or placement:

- dolly / zoom
- FOV changes
- target translation
- camera translation
- scene scale
- loaded point-cloud size

### 10. Sidebar layout

Give the ViewCube a fixed layout contract in the Camera tab.

Requirements:

- the entire cube stays inside its own container;
- the cube never overlaps "View Orientation:";
- the cube never overlaps the help text;
- help text is placed below the cube with a clear gap;
- the layout works at approximately the narrow VS Code sidebar width shown in the reported screenshot.

### 11. Visual styling

Target a CAD-like orientation cube:

- coherent gray faces
- clear borders
- strong edge definition
- brighter hover face
- highlighted active face/direction
- readable axis labels
- no detached white fragments
- no translucent rear-face bleed-through

Use VS Code theme variables where appropriate, but geometry must remain visually stable across themes.

## Tests

### A. Transform unit tests

Add tests for the Three.js → CSS orientation helper.

Cover at least:

- identity
- +X
- -X
- +Y
- -Y
- +Z
- -Z
- one isometric orientation

Verify no mirroring or sign inversion.

### B. Geometry tests

Update `engine/test/view-cube.spec.ts`.

Verify:

- six faces exist;
- twelve edge regions exist;
- eight corner regions exist;
- the cube has a non-zero sensible bounding box;
- at least two or three faces have meaningful visible projected dimensions in an isometric orientation;
- hidden rear faces do not appear as visible front-facing fragments.

### C. Canonical orientation tests

Set camera orientation to each of:

- +X
- -X
- +Y
- -Y
- +Z
- -Z

Verify the ViewCube orientation matches the expected face direction.

Also verify at least:

- two edge directions
- two corner directions

### D. Real pointer interaction

Use true Playwright pointer clicks on currently visible cube targets.

Do not use `.evaluate(el => el.click())` for the primary acceptance test.

After click, verify:

- expected camera direction
- unchanged rotation center / target
- unchanged camera radius
- +Z camera up
- completed view animation

### E. Narrow-sidebar regression

Render the Camera panel at approximately the reported VS Code sidebar width.

Verify:

- cube stays fully inside its scene container;
- no cube element overlaps the heading;
- no cube element overlaps the help text;
- help text begins below the cube.

### F. Existing navigation regressions

Keep all current Orbit tests passing to ensure the visual fix does not regress:

- LMB orbit
- pivot centering
- deterministic views
- animation cancellation
- +Z world-up
- zoom/pan
- point picking
- camera convention handling

## Visual Acceptance

Before packaging a new extension, render and inspect screenshots for:

- initial/isometric view
- +X
- +Y
- +Z
- arbitrary manually orbited view

Use actual VS Code sidebar dimensions.

Acceptance criteria:

- the gizmo looks like one solid cube;
- 2–3 visible faces meet at coherent edges/corners;
- rear faces are hidden;
- there are no floating white squares, slivers, or detached controls;
- axis labels remain readable;
- the cube rotates rigidly as a single object;
- manual Orbit interaction remains unchanged.

## Verification / Packaging

Run the full existing gate after the visual acceptance passes:

1. `svelte-check`
2. lint
3. standalone engine build
4. focused Orbit/ViewCube Playwright suite
5. remaining browser suite
6. VS Code extension-host suite
7. package a new VSIX

Do not package until all verification steps pass.

## Expected Files

Primary changes:

- `engine/src/components/ViewCube.svelte`
- `engine/src/viewCubeTransform.ts` (new)
- `engine/test/view-cube.spec.ts`

Possible minor supporting changes:

- `engine/src/cameraOrientation.ts` only if shared direction metadata needs to be centralized
- `engine/test/controls-camera-tabs.spec.ts` for narrow-sidebar layout coverage

Avoid unrelated changes to Orbit navigation or camera-control behavior.
