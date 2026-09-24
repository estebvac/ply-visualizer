# OrbitControls-First Navigation UX Design

**Status:** Proposed for implementation after review  
**Branch:** `recovered/voxel-camera-ui`  
**Date:** 2026-09-23  
**Reference UX:** Three.js OrbitControls official example and Varjo Teleport camera controls sample

## 1. Purpose

Make the PLY Visualizer camera interaction feel immediately familiar and predictable by using Three.js `OrbitControls` as the standard navigation experience instead of maintaining a custom CAD-style controller.

The target experience is the official Three.js OrbitControls interaction model, with the existing point-cloud-aware double-click picker layered on top for pivot selection.

The guiding architectural rule is:

> Three.js owns camera manipulation. The PLY Visualizer owns what the camera looks at.

## 2. Goals

The standard viewer experience must:

- start in native Three.js `OrbitControls`;
- use the official mouse mapping:
  - left drag: orbit;
  - middle drag: dolly;
  - right drag: pan;
  - mouse wheel: dolly;
- avoid inertial camera movement after mouse release;
- preserve the camera's current `up` direction rather than permitting trackball-style free roll;
- keep explicit Fit and Reset actions;
- use the existing point-cloud-aware picker for double-click pivot selection;
- make a successful double-click set the OrbitControls target to the picked 3D point while keeping the camera position fixed;
- preserve Shift + double-click measurement behavior;
- keep the recovered camera orientation selector and XYZ controls working against the same OrbitControls target;
- retain legacy navigation engines for compatibility, but move them out of the primary workflow;
- reduce navigation-specific custom code and duplicated behavior.

## 3. Non-Goals

This change will not:

- introduce a new `CadNavigationControls` implementation;
- replace Three.js OrbitControls math;
- introduce cursor-centered zoom in the first iteration;
- introduce camera inertia or damping;
- change point-cloud picking algorithms;
- redesign the camera orientation selector;
- change OpenCV/OpenGL camera-convention behavior;
- remove legacy Trackball, Inverse Trackball, custom Arcball, or CloudCompare/Turntable implementations;
- restructure unrelated viewer code;
- add a broad action-registry framework solely for navigation shortcuts.

## 4. Standard Navigation Contract

### 4.1 Default control engine

Both viewer state and runtime state use OrbitControls as the default:

- `PointCloudVisualizer.controlType = 'orbit'`;
- `viewerState.controlScheme = 'orbit'`.

A newly opened viewer must therefore never require the user to select Orbit mode manually.

### 4.2 OrbitControls configuration

The standard OrbitControls instance follows Three.js defaults wherever they already match the desired UX.

Required values:

```ts
orbitControls.enableDamping = false;
orbitControls.enableRotate = true;
orbitControls.enablePan = true;
orbitControls.enableZoom = true;

orbitControls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};

orbitControls.screenSpacePanning = true;
orbitControls.zoomToCursor = false;
orbitControls.minDistance = 0.001;
orbitControls.maxDistance = 50000;
```

The explicit mouse-button assignment is intentional even though it matches Three.js defaults. It makes the UX contract visible in code and protects against accidental remapping.

`rotateSpeed`, `panSpeed`, and `zoomSpeed` should remain at Three.js defaults unless browser tests reveal a project-specific regression. The implementation must not tune them pre-emptively.

### 4.3 Camera up direction

OrbitControls preserves `camera.up`, which is the desired behavior.

The navigation refactor must not hard-code a new up axis. Existing camera-convention and explicit up-vector features remain authoritative.

Switching from a legacy controller back to Standard Orbit must preserve:

- camera position;
- camera target;
- camera up vector;
- projection settings.

OrbitControls must call `update()` after state restoration or any programmatic camera transform.

## 5. Pivot / Rotation Center Interaction

### 5.1 Double-click geometry

The existing `SelectionManager` remains responsible for finding the 3D point under the pointer.

A normal double-click on successfully picked geometry must:

1. keep the current camera position fixed;
2. copy the selected 3D point into `controls.target`;
3. call `controls.update()`;
4. update axes/pivot feedback;
5. update camera UI state;
6. request a render.

This becomes the standard pivot behavior and corresponds to the existing `keep-camera` rotation-center mode.

### 5.2 Shift + double-click

Shift + double-click preserves the current measurement behavior:

- measure from the current rotation center to the selected point;
- do not change the OrbitControls target;
- request a render.

### 5.3 Double-click empty space

A failed double-click pick must be inert.

The existing special behavior:

> far empty-space double-click → Fit to View

must be removed from the standard interaction path.

Fit remains explicit through:

- the `F` shortcut;
- the `Fit to View` button.

This avoids unexpected camera jumps after an unsuccessful pick.

### 5.4 Rotation-center modes

`RotationCenterManager` remains for compatibility, but its role changes:

- `keep-camera` becomes the standard/default mode;
- `move-camera` and `keep-distance` remain available under Advanced Navigation;
- the standard user does not need to understand the three modes to navigate normally.

No rotation-center mode may implement its own orbit mathematics.

## 6. Controls UI

### 6.1 Primary controls

The normal Controls tab should communicate the navigation model rather than ask the user to choose an engine.

The current prominent **Control Type** section is replaced by a compact **Navigation** section containing:

- `Standard Orbit` status;
- mouse interaction help:
  - Left drag — Orbit
  - Middle drag / Wheel — Zoom
  - Right drag — Pan
  - Double-click — Set pivot
  - Shift + Double-click — Measure
  - F — Fit to View
  - R — Reset Camera

The UI should not display `T`, `O`, `I`, or `K` as normal-user shortcuts.

### 6.2 Advanced Navigation

Legacy navigation controls move into a collapsed Advanced Navigation section.

It contains:

- Standard Orbit;
- Trackball;
- Inverse Trackball;
- Arcball;
- CloudCompare/Turntable when currently exposed by the host;
- rotation-center behavior choices;
- legacy-only controls such as Arcball inversion/up-vector options when applicable.

Selecting Standard Orbit from Advanced must recreate the exact standard configuration from Section 4.2.

The Advanced section is compatibility UI, not a second primary navigation workflow.

## 7. Keyboard Behavior

Keep navigation shortcuts deliberately small.

Primary navigation shortcuts:

- `F` — Fit to View;
- `R` — Reset Camera.

The mode-switch shortcuts `T`, `O`, `I`, and `K` are removed from the normal global shortcut handler.

Legacy-mode selection occurs through Advanced Navigation.

Arcball-specific navigation shortcuts such as inversion and arbitrary up-vector changes must not silently affect Standard Orbit. If retained, they must only be active or visible in the legacy Advanced context.

Existing non-navigation shortcuts such as rendering, axes, EDL, transparency, and camera-convention shortcuts are outside the scope of this change unless they directly conflict with the navigation contract.

## 8. Camera Tab Integration

The recovered camera UI remains intact and uses the same live OrbitControls target.

### 8.1 Orientation presets

`cameraViews.ts` and `ViewOrientationSelector.svelte` continue to provide:

- +X / -X;
- +Y / -Y;
- +Z / -Z;
- ISO;
- opposite ISO.

Applying a preset must:

- preserve the current OrbitControls target;
- preserve camera-to-target distance;
- reposition/orient the camera;
- call `controls.update()`;
- update camera UI state;
- request a render.

### 8.2 XYZ camera position

Changing X/Y/Z camera position must:

- keep the current target;
- update the camera position;
- look at the target;
- call `controls.update()`;
- remain valid even for numeric values outside the slider's displayed range.

No duplicate camera target or pivot state is introduced.

## 9. Control Ownership and Lifecycle

Only one navigation control implementation may own pointer listeners at a time.

`initializeControls()` remains the control lifecycle boundary:

1. save camera position, target, and up vector;
2. dispose the current controls;
3. instantiate the requested controls;
4. configure the selected mode;
5. restore camera state;
6. call `controls.update()`;
7. refresh status/UI state.

For Standard Orbit, configuration must live in one focused helper rather than being duplicated across switch handlers.

Recommended helper:

```ts
private configureStandardOrbitControls(controls: OrbitControls): void
```

Legacy controllers may keep their current initialization paths.

No new shared base class is required.

## 10. Rendering Behavior

Standard Orbit uses `enableDamping = false`.

Consequences:

- camera movement stops when pointer interaction stops;
- there is no need to render extra frames for inertial settling;
- the existing on-demand rendering strategy can respond to OrbitControls `change` events;
- `controls.update()` is still required after programmatic camera/target changes.

This intentionally favors deterministic CAD/viewer behavior over animated camera weight.

## 11. Error and Edge-Case Behavior

### Picking failures

- near miss: camera and target remain unchanged;
- far empty-space miss: camera and target remain unchanged;
- large clouds: existing screen-space point-picking performance guarantees remain intact.

### Invalid pivot

If the selected point is numerically invalid or unusably close to the camera, the existing safety logic may adjust/reject it, but it must never produce NaN camera state.

### Switching controls

Switching between Standard Orbit and a legacy controller must not visibly jump the camera.

### Programmatic camera edits

Fit, Reset, orientation presets, XYZ position changes, and rotation-center edits must leave OrbitControls synchronized with the camera before the next user interaction.

## 12. Testing Strategy

Implementation follows TDD and extends the existing Playwright/browser regression suite.

### Default standard controls

Verify:

- new viewer starts with `controlType === 'orbit'`;
- `viewerState.controlScheme === 'orbit'`;
- controls instance is OrbitControls;
- damping is disabled;
- screen-space panning is enabled;
- zoom-to-cursor is disabled;
- the mouse mapping matches the standard contract.

### Mouse interactions

With a loaded point cloud:

- LMB drag changes orbit angles while target and distance remain stable;
- MMB drag changes camera-target distance without panning target;
- RMB drag moves camera and target together while distance remains stable;
- wheel changes camera-target distance;
- camera movement stops after pointer/wheel interaction finishes.

### Up-vector stability

Sustained orbit operations must:

- keep all camera values finite;
- preserve a normalized up vector;
- avoid free-roll drift;
- preserve the configured up direction.

### Pivot behavior

Verify:

- double-clicking a point changes target to the picked point;
- camera position stays fixed;
- Shift + double-click creates a measurement without changing target;
- failed near-miss double-click is inert;
- far empty-space double-click is also inert;
- explicit Fit still works afterward.

Existing large-cloud point-picking performance tests remain mandatory.

### Camera tab

Verify:

- orientation presets preserve target and distance;
- XYZ position edits preserve target;
- a preset/XYZ change followed by mouse orbit produces no camera jump.

### Legacy compatibility

Verify:

- each retained legacy mode can still be selected from Advanced Navigation;
- switching back to Standard Orbit restores the Section 4.2 configuration;
- camera position/target/up survive the switch.

## 13. Files Expected to Change

The implementation is expected to modify:

- `engine/src/main.ts`
  - default control type;
  - standard OrbitControls configuration;
  - double-click behavior;
  - keyboard shortcut cleanup;
  - control lifecycle integration.

- `engine/src/controlSchemeSwitcher.ts`
  - Standard Orbit semantics;
  - legacy switching/status handling.

- `engine/src/RotationCenterManager.ts`
  - default mode becomes `keep-camera`.

- `engine/src/components/ControlsTabTop.svelte`
  - primary Navigation help;
  - collapsed Advanced Navigation;
  - removal of normal-user control-engine shortcuts.

- `engine/src/state/viewer.svelte.js`
  - default control scheme becomes `orbit`.

- `engine/index.html`
  - static Help/shortcuts copy updated to the Standard Orbit mouse contract;
  - legacy T/O/I/K shortcut descriptions removed.

VS Code host files are expected to remain behaviorally unchanged:

- `src/extension.ts`
  - retain the existing `retainContextWhenHidden: true` custom-editor registration;
- `src/pointCloudEditorProvider.ts`
  - no new navigation message types or CSP changes.

Modify those host files only if verification exposes a concrete integration problem.

Tests expected to change/add include:

- `engine/test/controls-camera-tabs.spec.ts`;
- `engine/test/point-picking.spec.ts`;
- a focused OrbitControls interaction Playwright spec;
- legacy navigation regression coverage as needed.

`engine/src/controls.ts` should require no Standard Orbit implementation changes; it remains only for legacy custom controllers unless tests expose a compatibility issue.

`engine/src/cameraViews.ts` and `CameraControlsPanel.svelte` should remain behaviorally unchanged unless synchronization tests expose a missing `controls.update()` call.

## 14. VS Code Custom Editor Requirements

The primary product surface is a VS Code custom editor webview, not a normal top-level browser page. The standalone browser build remains useful for automated interaction tests, but implementation decisions must also respect the VS Code host.

### 14.1 Webview execution model

The viewer is hosted by `PointCloudEditorProvider` as a VS Code `CustomReadonlyEditorProvider`. The webview already enables scripts and loads the compiled viewer bundle through `webview.asWebviewUri()` under a nonce-based Content Security Policy.

OrbitControls is bundled into the existing `main.js` by webpack. The navigation change must therefore:

- add no remote script, CDN, or external runtime dependency;
- require no CSP relaxation;
- require no new extension-to-webview message type;
- continue to initialize entirely inside the existing webview bundle.

The existing `webviewReady` message gate must remain unrelated to camera navigation. Navigation must be usable once the webview JavaScript initializes, regardless of whether file data is still being transferred.

### 14.2 Webview lifecycle and hidden tabs

The extension already registers the custom editor with:

```ts
webviewOptions: {
  retainContextWhenHidden: true,
}
```

That behavior is intentionally retained for this feature. A hidden/revealed editor must keep the current camera, target, selected navigation mode, and loaded GPU scene without reinitializing OrbitControls.

This task must not add a second camera-persistence mechanism such as `acquireVsCodeApi().setState()` solely for navigation. If VS Code fully destroys and recreates the custom editor, a fresh viewer may start with the normal Standard Orbit defaults and the existing document loading/fit flow.

### 14.3 Right-click ownership and VS Code context menus

VS Code webviews can provide a context menu on `contextmenu`. Standard Orbit assigns right mouse drag to pan, so the canvas must suppress the host/webview context menu for right-click interactions.

Requirement:

- right-click/drag on `#three-canvas` must be consumed by OrbitControls and must not open the VS Code webview context menu;
- context-menu behavior outside the 3D canvas must not be globally disabled.

OrbitControls already installs a canvas-level `contextmenu` handler. The implementation should rely on that native behavior if verified in the VS Code host. Add an extra canvas listener only if the host smoke test demonstrates that OrbitControls alone is insufficient.

### 14.4 Pointer capture and touch behavior

OrbitControls must stay connected directly to `renderer.domElement` / `#three-canvas`. Pointer capture, pointer move/up, wheel, and touch listeners must not be proxied through the VS Code extension host.

No extension-side mouse messages are introduced.

The implementation must verify that dragging continues correctly when the pointer moves rapidly within the webview and that releasing the pointer ends the interaction without sticky orbit/pan state.

### 14.5 Keyboard ownership

The viewer already has its own document-level shortcut handler. OrbitControls' optional `listenToKeyEvents()` must **not** be enabled.

Reasons:

- VS Code owns many keyboard commands at the workbench level;
- the visualizer already uses arrow/navigation keys in sequence workflows;
- duplicate key listeners would make the active behavior depend on focus and event ordering.

Only the application's existing shortcut handler owns `F` and `R` for Fit and Reset. Shortcuts remain disabled while an input, textarea, or select element has focus.

### 14.6 Focus and editor interaction

Mouse navigation must work whenever the pointer is over the canvas without requiring the canvas to become a separately tab-focusable control.

The task must not add a `tabindex` merely to support OrbitControls because mouse/pointer navigation does not require it. This also avoids changing VS Code keyboard focus traversal.

Clicking controls in the Svelte side panels must not leave OrbitControls in a dragging state, and returning the pointer to the canvas must resume normal navigation.

### 14.7 Rendering and background behavior

Standard Orbit uses `enableDamping = false`, so it does not require a perpetual animation loop. This is especially important inside VS Code, where hidden or inactive editors should not spend frames on inertial camera settling.

The existing on-demand `requestRender()` strategy remains authoritative. OrbitControls `change` events request renders only while the camera is actively changing or when a programmatic camera operation occurs.

### 14.8 VS Code-specific verification

Browser Playwright tests remain the fast automated interaction layer, but release verification must also cover the actual VS Code custom editor because browser tests cannot prove workbench/webview context-menu and focus behavior.

The VS Code host smoke test must verify:

1. open a supported file through `plyViewer.plyEditor`;
2. confirm Standard Orbit is active immediately;
3. LMB orbit works;
4. MMB and wheel dolly work;
5. RMB pans without opening a VS Code context menu;
6. double-click pivot and Shift + double-click measurement work;
7. `F` and `R` work while the canvas/webview has focus;
8. shortcuts do not fire while editing a numeric/text input;
9. switch to another editor tab and back; camera/target remain unchanged because `retainContextWhenHidden` is enabled;
10. switch to a legacy mode and back to Standard Orbit without camera jump;
11. close and reopen the editor; the viewer initializes cleanly with Standard Orbit and existing file-loading behavior.

The extension-host regression suite must still pass, including custom editor registration, CSP/resource loading, ready-gate behavior, and disposal.

## 15. Acceptance Criteria

The change is complete when:

1. a fresh viewer opens directly in Standard Orbit;
2. mouse navigation feels like the official Three.js OrbitControls example;
3. no custom camera controller is used for the standard experience;
4. LMB orbit, MMB/wheel zoom, and RMB pan work consistently;
5. no damping/inertia continues after input stops;
6. double-clicking geometry sets the pivot without moving the camera;
7. Shift + double-click still measures;
8. double-clicking empty space never triggers Fit;
9. Fit and Reset remain explicit and reliable;
10. recovered orientation and XYZ camera controls remain synchronized;
11. legacy control engines remain accessible under Advanced Navigation;
12. switching modes does not jump or corrupt camera state;
13. all focused navigation/picking tests and the existing relevant regression suite pass;
14. the bundled navigation requires no CSP relaxation or new webview message protocol;
15. RMB pan works inside the real VS Code custom editor without opening the webview context menu;
16. hiding and restoring the editor preserves camera/target state under the existing `retainContextWhenHidden` configuration;
17. the VS Code custom-editor smoke checklist in Section 14.8 passes.

## 16. Reference Behavior

The standard behavior intentionally follows Three.js OrbitControls rather than reproducing it manually:

- Three.js OrbitControls documentation: https://threejs.org/docs/pages/OrbitControls.html
- Three.js official example: https://threejs.org/examples/misc_controls_orbit.html
- Varjo Teleport camera controls sample: https://d1ziouw89q7sp5.cloudfront.net/teleport-js/samples/camera_controls.html
- VS Code Webview API: https://code.visualstudio.com/api/extension-guides/webview
- VS Code Custom Editor API: https://code.visualstudio.com/api/extension-guides/custom-editors

The project currently uses Three.js `^0.185.0`; implementation should use the OrbitControls API already present in that dependency and must not add a competing navigation dependency.