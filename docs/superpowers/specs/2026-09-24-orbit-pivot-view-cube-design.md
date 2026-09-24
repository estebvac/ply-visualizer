# Orbit Pivot and View Cube Design

**Date:** 2026-09-24  
**Base:** `feature/orbitcontrols-navigation` @ `c95f3d022c4a007ecce95c18bc7d5230358cd0ab`

## Goal

Make left-drag OrbitControls feel like the official Three.js OrbitControls example by giving it one stable navigation frame and a predictable center of rotation, then replace the current pseudo-cube preset UI with a synchronized, animated CSS 3D view cube.

## Diagnosis

### 1. There is no second hidden OrbitControls pivot

Three.js OrbitControls rotates around `controls.target`. The viewer currently:
- sets `controls.target` to the loaded scene bounding-box center during Fit;
- preserves that target when changing camera XYZ or applying a view preset;
- intentionally changes it on a normal double-click.

The official Three.js demo feels centered because its target stays at the model/scene center. Our viewer can deliberately move that target, so an explicit double-click pivot remains meaningful.

### 2. The bigger mismatch is the orbit reference frame

`cameraViews.ts` currently calls:

```ts
camera.up.copy(stableUpVector(direction, camera.up));
```

That means a preset's orientation depends on the camera's previous `up` vector. Example:
- from +Z, +X may use +Y as up;
- after visiting a +Y view, the fallback can change `camera.up` to +Z;
- returning to +X can then be rolled 90° relative to the earlier +X view.

OrbitControls uses `camera.up` as its orbit axis. Therefore changing `camera.up` between presets also changes how subsequent left-drag rotation behaves. This matches the reported feeling that the camera is rotating around a different reference even though the target itself is still `controls.target`.

The official OrbitControls example keeps a stable up direction.

### 3. Current view orientation presets are stateful

The current preset directions are deterministic, but their roll is not. `stableUpVector()` derives each new up vector from the previous camera state. That is why only some views appear consistently correct.

### 4. Current pseudo-cube is not a camera orientation widget

`ViewOrientationSelector.svelte` is a static 2D illustration plus eight buttons. It does not:
- rotate as the camera rotates;
- expose the camera's current orientation;
- animate between orientations;
- provide face/edge/corner interaction.

The linked Three.js forum concept uses a CSS 3D cube derived from the DeSandro cube and applies camera orientation to it. This is a better fit for the requested CAD-like experience.

## Design decisions

### Stable Standard Orbit navigation frame

Use one immutable Standard Orbit world-up:

```ts
export const NAVIGATION_UP = new THREE.Vector3(0, 0, 1);
```

This matches the existing UI's +Z "top" convention and the user's feedback that +Z is the correct view.

Set `camera.up` to `NAVIGATION_UP` before creating Standard OrbitControls and do not mutate `camera.up` from ordinary view presets.

Top/bottom views are OrbitControls pole cases. Snap them using deterministic azimuth plus a tiny polar epsilon rather than changing `camera.up`.

Legacy Trackball/Arcball modes keep their existing behavior.

### Target invariant

Standard Orbit must always orbit around `controls.target`.

Operations that should preserve target:
- left-drag orbit;
- wheel/MMB dolly;
- camera XYZ edit;
- view-cube face/edge/corner snap;
- axis/ISO presets.

Operations allowed to change target:
- pan/arrow pan;
- Fit;
- explicit double-click pivot;
- explicit rotation-center editing.

For operations that center on a target, the projected target must land at the canvas center within rendering tolerance.

### Deterministic camera orientation model

Create a central orientation utility that defines views using directions in world coordinates, not inherited camera state.

At minimum:
- +X, -X, +Y, -Y, +Z, -Z;
- the existing two ISO views;
- edge/corner diagonals used by the view cube.

Each view resolves to a deterministic orbit direction around the current target and preserves camera-target distance.

### CSS 3D view cube

Replace the current static pseudo-cube with a real DOM/CSS 3D cube inspired by:
- David DeSandro's six-face CSS cube;
- the Three.js forum CSS view-cube concept.

The cube:
- lives in the Camera tab;
- uses six DOM faces with `transform-style: preserve-3d`;
- labels faces by axis (`+X`, `-X`, `+Y`, `-Y`, `+Z`, `-Z`) to avoid ambiguous Front/Back semantics;
- rotates continuously to mirror the main camera;
- animates when the main camera snaps;
- allows face clicks for orthogonal views;
- allows edge/corner hotspots for diagonal views;
- highlights the face/edge/corner closest to the current camera orientation.

No second Three.js renderer is needed for the cube.

### Smooth camera snap

A cube click starts a short camera transition (target ~250 ms):
- preserve `controls.target`;
- preserve camera-target distance;
- interpolate the camera orbit direction on the sphere;
- use an easing curve;
- call `controls.update()` and render every animation frame;
- cancel the transition immediately on direct pointer/wheel/keyboard camera interaction.

Do not animate the scene itself.

### VS Code constraints

The view cube remains ordinary Svelte/DOM/CSS inside the webview:
- no new extension-host messages;
- no CSP changes;
- no remote assets/scripts;
- no second canvas;
- no changes to `retainContextWhenHidden`.

## Interaction contract

- Left drag: OrbitControls rotation around current `controls.target`.
- RMB drag / arrow keys: pan target and camera together.
- MMB / wheel: dolly.
- Double-click geometry: set target explicitly.
- View cube face: snap to axis view.
- View cube edge: snap to two-axis diagonal.
- View cube corner: snap to isometric/three-axis diagonal.
- Dragging the cube itself is not required in the first implementation.

## Coordinate convention

Initial implementation assumes **+Z is world up**.

The view cube will use axis labels, not Front/Back/Left/Right labels. This avoids imposing a domain-specific definition such as automotive +X-forward on a general PLY viewer.

## Acceptance criteria

1. Starting from any view preset, a horizontal left-drag has the same stable OrbitControls frame and does not inherit roll from the previous preset.
2. Re-selecting the same view preset from any prior camera orientation produces the same camera roll/orientation.
3. `controls.target` projects to the visual canvas center after Fit, view-cube snaps, XYZ edits, and explicit pivot changes.
4. +X/-X/+Y/-Y/+Z/-Z are visually deterministic.
5. The view cube mirrors the camera while orbiting.
6. Clicking a cube face preserves target and distance.
7. Clicking an edge/corner produces deterministic diagonal views.
8. Manual camera interaction cancels an in-progress snap animation without a jump.
9. Standard Orbit arrow/mouse behavior from the previous feature remains unchanged.
10. VS Code extension-host tests and packaging remain green.

## Non-goals

- No draggable free-rotation interaction on the view cube in the first version.
- No semantic Front/Back labels until a project-wide convention is explicitly chosen.
- No orthographic-camera conversion.
- No replacement of Three.js OrbitControls.
