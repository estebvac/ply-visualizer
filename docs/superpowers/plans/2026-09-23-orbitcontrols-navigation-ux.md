# OrbitControls-First Navigation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native Three.js OrbitControls the default PLY Visualizer navigation experience in both the standalone browser host and the VS Code custom-editor webview, while preserving point-cloud pivot picking, camera presets, and legacy control modes under Advanced Navigation.

**Architecture:** Standard navigation is a configured Three.js `OrbitControls` instance attached directly to `renderer.domElement`. A small focused helper owns the standard configuration; `SelectionManager` and `RotationCenterManager` own pivot selection, while legacy controllers remain isolated behind Advanced Navigation. VS Code adds no alternate navigation implementation: the same webview bundle runs there, with host-specific verification for context menus, keyboard focus, lifecycle, CSP, and hidden-tab behavior.

**Tech Stack:** TypeScript 6, Three.js `^0.185.0`, Svelte 5, Playwright 1.59, VS Code Custom Editor/Webview API, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-09-23-orbitcontrols-navigation-ux-design.md`

## Global Constraints

- Implement from `recovered/voxel-camera-ui`; create an implementation branch such as `feature/orbitcontrols-navigation` at execution time so the recovered source snapshot remains recoverable.
- Standard navigation must use Three.js `OrbitControls`; do not add a custom CAD navigation controller.
- Standard mouse mapping is exactly LMB = rotate, MMB = dolly, RMB = pan, wheel = dolly.
- `enableDamping = false`, `screenSpacePanning = true`, `zoomToCursor = false`.
- Preserve the current camera `up` vector; do not force a new world-up axis.
- Standard double-click pivot keeps camera position fixed and changes only the target.
- Shift + double-click measures without changing the target.
- Empty-space double-click is inert; Fit remains explicit through `F` and the Fit button.
- Do not call `OrbitControls.listenToKeyEvents()`.
- Do not add remote scripts, CSP relaxations, or new extension↔webview message types for navigation.
- Keep the existing VS Code `retainContextWhenHidden: true` custom-editor option.
- RMB navigation must suppress the VS Code webview context menu on `#three-canvas` but must not globally disable context menus elsewhere.
- Keep existing camera presets and XYZ position editing synchronized through `controls.update()`.
- Retain Trackball, Inverse Trackball, and Arcball as legacy Advanced Navigation options. The existing unused CloudCompare/Turntable implementation stays unexposed.
- Follow TDD for changed behavior and commit after each task.

## Review Focus

1. **VS Code canvas right-click:** RMB drag must pan and the canvas `contextmenu` event must be default-prevented; Task 1 adds browser coverage and Task 5 verifies the real VS Code host.
2. **Focused numeric/text inputs:** pressing `F` or `R` while editing a field must not move the camera; Task 3 adds a browser regression test.
3. **Legacy → Standard Orbit transition:** camera position, target, up vector, and projection must survive without a jump; Task 4 pins this behavior.
4. **Failed point pick:** both near misses and far empty-space double-clicks must leave camera and target unchanged; Task 2 updates the existing point-picking regression.
5. **Hidden/revealed VS Code tab:** camera and target must survive because `retainContextWhenHidden` is already enabled; Task 5 verifies the actual custom editor and the extension-host registration test.

---

## File Structure

### New file

- `engine/src/orbitNavigation.ts`
  - One responsibility: configure a real Three.js `OrbitControls` instance with the application's Standard Orbit contract.

- `engine/test/orbit-navigation.spec.ts`
  - One responsibility: browser-level interaction contract for Standard Orbit, including mouse mapping, no inertia, context-menu suppression, camera up stability, and control switching.

### Modified production files

- `engine/src/main.ts`
  - Default control type, OrbitControls initialization, double-click miss behavior, and keyboard shortcut ownership.
- `engine/src/controlSchemeSwitcher.ts`
  - Standard Orbit wording/status and switching semantics.
- `engine/src/RotationCenterManager.ts`
  - Default rotation-center mode becomes `keep-camera`.
- `engine/src/components/ControlsTabTop.svelte`
  - Primary Navigation help plus collapsed Advanced Navigation legacy controls.
- `engine/src/state/viewer.svelte.js`
  - Default UI control scheme becomes `orbit`.
- `engine/index.html`
  - Static keyboard/mouse Help reflects the actual Standard Orbit interaction contract.

### Modified tests

- `engine/test/controls-camera-tabs.spec.ts`
- `engine/test/point-picking.spec.ts`
- `engine/test/browser/mainVisualizerInteraction.test.ts`
- `src/test/suite/pointCloudEditorProviderAdvanced.test.ts`

### Expected unchanged host/integration files

- `src/extension.ts` — keep `retainContextWhenHidden: true`.
- `src/pointCloudEditorProvider.ts` — no new navigation messages and no CSP changes.
- `engine/src/cameraViews.ts` — already calls `controls.update()` after presets/XYZ changes.

---

## Task 1: Make Standard Orbit the real default and pin the mouse contract

**Files:**
- Create: `engine/src/orbitNavigation.ts`
- Create: `engine/test/orbit-navigation.spec.ts`
- Modify: `engine/src/main.ts` around imports, `controlType`, and `initializeControls()`
- Modify: `engine/src/state/viewer.svelte.js`

**Interfaces:**
- Produces: `configureStandardOrbitControls(controls: OrbitControls): void`
- Consumes: Three.js `OrbitControls`, `THREE.MOUSE`, existing `renderer.domElement`, existing camera state restoration in `initializeControls()`.

- [ ] **Step 1: Add a failing Playwright test for the default Standard Orbit configuration**

Create `engine/test/orbit-navigation.spec.ts` with a first test that boots the viewer and inspects the live visualizer:

```ts
import { test, expect, Page } from '@playwright/test';

async function getNavigationState(page: Page) {
  return page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      controlType: v.controlType,
      ctor: v.controls?.constructor?.name,
      enableDamping: v.controls?.enableDamping,
      enableRotate: v.controls?.enableRotate,
      enablePan: v.controls?.enablePan,
      enableZoom: v.controls?.enableZoom,
      screenSpacePanning: v.controls?.screenSpacePanning,
      zoomToCursor: v.controls?.zoomToCursor,
      mouseButtons: { ...v.controls?.mouseButtons },
      minDistance: v.controls?.minDistance,
      maxDistance: v.controls?.maxDistance,
    };
  });
}

test.describe('Standard Orbit navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/3d-visualizer/');
    await page.waitForSelector('#three-canvas');
    await page.waitForFunction(() => Boolean((window as any).visualizer?.controls));
  });

  test('starts in the native Standard Orbit configuration', async ({ page }) => {
    const state = await getNavigationState(page);
    expect(state.controlType).toBe('orbit');
    expect(state.ctor).toBe('OrbitControls');
    expect(state.enableDamping).toBe(false);
    expect(state.enableRotate).toBe(true);
    expect(state.enablePan).toBe(true);
    expect(state.enableZoom).toBe(true);
    expect(state.screenSpacePanning).toBe(true);
    expect(state.zoomToCursor).toBe(false);
    expect(state.mouseButtons).toEqual({ LEFT: 0, MIDDLE: 1, RIGHT: 2 });
    expect(state.minDistance).toBeCloseTo(0.001);
    expect(state.maxDistance).toBe(50000);
  });
});
```

The numeric mouse constants correspond to Three.js `MOUSE.ROTATE = 0`, `MOUSE.DOLLY = 1`, `MOUSE.PAN = 2`.

- [ ] **Step 2: Run the test and verify the current branch fails for the intended reasons**

Run:

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts --project=chromium
```

Expected: FAIL because the viewer starts as `trackball`; once Orbit is selected manually, the current Orbit configuration also has damping enabled and screen-space panning disabled.

- [ ] **Step 3: Add the focused Standard Orbit configuration helper**

Create `engine/src/orbitNavigation.ts`:

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function configureStandardOrbitControls(controls: OrbitControls): void {
  controls.enableDamping = false;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = false;
  controls.minDistance = 0.001;
  controls.maxDistance = 50000;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
}
```

Do not set `rotateSpeed`, `panSpeed`, or `zoomSpeed`; native Three.js defaults are part of the UX contract.

- [ ] **Step 4: Wire Standard Orbit into `main.ts` and change both defaults**

Add:

```ts
import { configureStandardOrbitControls } from './orbitNavigation';
```

Change the runtime default:

```ts
controlType: 'trackball' | 'orbit' | 'inverse-trackball' | 'arcball' | 'cloudcompare' =
  'orbit';
```

Replace the current inline Orbit configuration block with:

```ts
this.controls = new OrbitControls(this.camera, this.renderer.domElement);
configureStandardOrbitControls(this.controls as OrbitControls);
```

Keep the existing save/dispose/restore sequence exactly around it:

```ts
this.camera.position.copy(currentCameraPosition);
this.camera.up.copy(currentUp);
this.controls.target.copy(currentTarget);
this.controls.update();
```

Change `engine/src/state/viewer.svelte.js`:

```js
controlScheme: 'orbit',
```

Do not call `listenToKeyEvents()`.

- [ ] **Step 5: Add mouse interaction tests for LMB, MMB, RMB, wheel, and no inertia**

Extend `engine/test/orbit-navigation.spec.ts` with helpers that capture camera state:

```ts
async function cameraState(page: Page) {
  return page.evaluate(() => {
    const v: any = (window as any).visualizer;
    const p = v.camera.position;
    const t = v.controls.target;
    const u = v.camera.up;
    return {
      position: [p.x, p.y, p.z],
      target: [t.x, t.y, t.z],
      up: [u.x, u.y, u.z],
      distance: p.distanceTo(t),
    };
  });
}

function delta3(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
```

Load `../testfiles/open3d/sample_mesh.ply`, then assert:

```ts
// LMB: position changes, target and distance remain stable.
expect(delta3(afterLeft.position, before.position)).toBeGreaterThan(1e-4);
expect(delta3(afterLeft.target, before.target)).toBeLessThan(1e-6);
expect(Math.abs(afterLeft.distance - before.distance)).toBeLessThan(1e-4);

// MMB: dolly changes distance, target remains stable.
expect(Math.abs(afterMiddle.distance - afterLeft.distance)).toBeGreaterThan(1e-4);
expect(delta3(afterMiddle.target, afterLeft.target)).toBeLessThan(1e-6);

// RMB: pan moves camera and target together, preserving their relative vector.
expect(delta3(afterRight.target, afterMiddle.target)).toBeGreaterThan(1e-4);
expect(Math.abs(afterRight.distance - afterMiddle.distance)).toBeLessThan(1e-4);

// Wheel: distance changes.
expect(Math.abs(afterWheel.distance - afterRight.distance)).toBeGreaterThan(1e-4);
```

After mouse release, capture state, wait 300 ms, capture again, and assert the camera/target are unchanged within `1e-6` to pin the no-damping/no-inertia contract.

- [ ] **Step 6: Add canvas context-menu suppression coverage**

In the same spec, observe bubbling `contextmenu` events after OrbitControls' target handler:

```ts
await page.evaluate(() => {
  (window as any).__canvasContextMenuPrevented = false;
  document.addEventListener(
    'contextmenu',
    e => {
      if ((e.target as HTMLElement)?.id === 'three-canvas') {
        (window as any).__canvasContextMenuPrevented = e.defaultPrevented;
      }
    },
    { once: true }
  );
});

await page.locator('#three-canvas').click({ button: 'right' });

expect(
  await page.evaluate(() => (window as any).__canvasContextMenuPrevented)
).toBe(true);
```

This proves the browser/webview DOM contract. Do not add a second `contextmenu` listener in product code unless the real VS Code smoke test in Task 5 disproves native OrbitControls behavior.

- [ ] **Step 7: Run focused tests and Svelte/type checks**

Run:

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts --project=chromium
pnpm run check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add engine/src/orbitNavigation.ts engine/src/main.ts engine/src/state/viewer.svelte.js engine/test/orbit-navigation.spec.ts
git commit -m "feat: make standard OrbitControls navigation default"
```

---

## Task 2: Make double-click pivot predictable and remove implicit empty-space Fit

**Files:**
- Modify: `engine/src/RotationCenterManager.ts`
- Modify: `engine/src/main.ts` in `onDoubleClick()`
- Modify: `engine/test/point-picking.spec.ts`
- Modify: `engine/test/orbit-navigation.spec.ts`

**Interfaces:**
- Consumes: existing `RotationCenterManager.setRotationCenter()`, `SelectionManager.selectPointWithLogging()`, `controls.target`.
- Produces: default `RotationCenterManager.getMode() === 'keep-camera'`; no new public API.

- [ ] **Step 1: Change the point-picking expectation so far empty space must be inert**

Replace the existing test named:

```ts
'near-miss stays inert; double-click far into empty space refits the view'
```

with:

```ts
'near-miss and far empty-space double-clicks are both inert'
```

Capture camera and target before each miss:

```ts
const beforeMiss = await page.evaluate(() => {
  const v: any = (window as any).visualizer;
  return {
    position: v.camera.position.toArray(),
    target: v.controls.target.toArray(),
  };
});
```

After the near miss and far miss, assert:

```ts
expect(logs.join('\n')).toContain('No selectable object found');
expect(logs.join('\n')).not.toContain('fitting view to all objects');

const afterMiss = await page.evaluate(() => {
  const v: any = (window as any).visualizer;
  return {
    position: v.camera.position.toArray(),
    target: v.controls.target.toArray(),
  };
});

expect(afterMiss.position).toEqual(beforeMiss.position);
expect(afterMiss.target).toEqual(beforeMiss.target);
```

- [ ] **Step 2: Add a pivot regression asserting camera position stays fixed**

In `engine/test/orbit-navigation.spec.ts`, load a visible point cloud, capture camera position and target, dispatch a double-click that produces the existing `screen-space pick` log, then assert:

```ts
expect(delta3(after.position, before.position)).toBeLessThan(1e-6);
expect(delta3(after.target, before.target)).toBeGreaterThan(1e-6);
```

For Shift + double-click, assert the measurement count increments while target remains unchanged. Read the actual manager state from `window.visualizer.measurementManager`; do not infer success only from a status string.

- [ ] **Step 3: Run the two focused tests and verify failure**

Run:

```bash
cd engine
pnpm exec playwright test test/point-picking.spec.ts test/orbit-navigation.spec.ts --project=chromium
```

Expected failures:
- far empty-space currently triggers Fit;
- `RotationCenterManager` currently defaults to `move-camera`, so normal double-click can move the camera laterally.

- [ ] **Step 4: Make `keep-camera` the rotation-center default**

In `engine/src/RotationCenterManager.ts` change:

```ts
private mode: RotationCenterMode = 'keep-camera';
```

Keep `move-camera` and `keep-distance` implementations unchanged for Advanced Navigation.

- [ ] **Step 5: Remove only the implicit empty-space Fit block**

In `main.ts:onDoubleClick()`, delete the branch that calls:

```ts
this.selectionManager.isFarFromAllVisibleObjects(...)
this.fitCameraToAllObjects();
```

Leave the final failed-pick log in place:

```ts
console.log(
  `❌ No selectable object found at (${mouseScreenX.toFixed(1)}, ${mouseScreenY.toFixed(1)})`
);
```

Do not change `SelectionManager` or its large-cloud picker.

- [ ] **Step 6: Re-run point-picking and navigation tests**

```bash
cd engine
pnpm exec playwright test test/point-picking.spec.ts test/orbit-navigation.spec.ts --project=chromium
```

Expected: PASS, including the existing two-million-point picking performance bound.

- [ ] **Step 7: Commit Task 2**

```bash
git add engine/src/RotationCenterManager.ts engine/src/main.ts engine/test/point-picking.spec.ts engine/test/orbit-navigation.spec.ts
git commit -m "feat: make double-click set a stable orbit pivot"
```

---

## Task 3: Simplify the Controls UI and keyboard model

**Files:**
- Modify: `engine/src/components/ControlsTabTop.svelte`
- Modify: `engine/src/controlSchemeSwitcher.ts`
- Modify: `engine/src/main.ts` keyboard handler
- Modify: `engine/index.html`
- Modify: `engine/test/controls-camera-tabs.spec.ts`
- Modify: `engine/test/browser/mainVisualizerInteraction.test.ts`

**Interfaces:**
- Consumes: existing host methods `switchToOrbitControls()`, `switchToTrackballControls()`, `switchToInverseTrackballControls()`, `switchToArcballControls()`, `rotationCenterManager.setMode()`.
- Produces: DOM contract `#advanced-navigation` and existing control button IDs retained inside it.

- [ ] **Step 1: Update the Controls-tab test to define the desired UI**

In `engine/test/controls-camera-tabs.spec.ts`, replace the default Trackball assertion with:

```ts
const orbitBtn = page.locator('#orbit-controls');
await expect(orbitBtn).toHaveClass(/active/);
await expect(page.locator('#navigation-help')).toContainText('Left drag');
await expect(page.locator('#navigation-help')).toContainText('Right drag');
await expect(page.locator('#navigation-help')).toContainText('Middle drag');
```

Add Advanced Navigation assertions:

```ts
const advanced = page.locator('#advanced-navigation');
await expect(advanced).not.toHaveAttribute('open', '');

await advanced.locator('summary').click();
const trackballBtn = page.locator('#trackball-controls');
await trackballBtn.click();
await expect(trackballBtn).toHaveClass(/active/);

await orbitBtn.click();
await expect(orbitBtn).toHaveClass(/active/);
```

- [ ] **Step 2: Add a keyboard-focus regression**

In `engine/test/orbit-navigation.spec.ts`:

1. load a point cloud;
2. focus `#camera-fov` or a camera position numeric field;
3. record camera state;
4. press `F`, then `R`;
5. assert camera state is unchanged because the global shortcut handler must ignore inputs.

Use:

```ts
await page.click('[data-tab="camera"]');
await page.locator('#camera-fov').focus();
const before = await cameraState(page);
await page.keyboard.press('F');
await page.keyboard.press('R');
const after = await cameraState(page);

expect(delta3(after.position, before.position)).toBeLessThan(1e-6);
expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
```

- [ ] **Step 3: Run the UI/focus tests and verify they fail against the current UI**

```bash
cd engine
pnpm exec playwright test test/controls-camera-tabs.spec.ts test/orbit-navigation.spec.ts --project=chromium
```

Expected: Controls-tab assertions fail because Control Type is still primary and Trackball expectations are stale. The focused-input behavior should already pass and becomes regression coverage.

- [ ] **Step 4: Replace the primary Control Type section with Standard Navigation help**

In `ControlsTabTop.svelte`, add a compact primary block:

```svelte
<div class="panel-section">
  <h4>Navigation</h4>
  <div id="navigation-help" class="setting-description">
    <div><strong>Left drag</strong> — Orbit</div>
    <div><strong>Middle drag / Wheel</strong> — Zoom</div>
    <div><strong>Right drag</strong> — Pan</div>
    <div><strong>Double-click</strong> — Set pivot</div>
    <div><strong>Shift + Double-click</strong> — Measure</div>
    <div><strong>F</strong> — Fit to View</div>
    <div><strong>R</strong> — Reset Camera</div>
  </div>
</div>
```

Move the existing mode buttons and rotation-center behavior into:

```svelte
<details id="advanced-navigation" class="panel-section">
  <summary>Advanced Navigation</summary>
  <p class="setting-description">
    Legacy navigation modes and alternative pivot behaviors.
  </p>

  <div class="control-buttons">
    <button
      id="orbit-controls"
      class="control-button"
      class:active={viewerState.controlScheme === 'orbit'}
      onclick={onOrbit}
    >Standard Orbit</button>

    <button
      id="trackball-controls"
      class="control-button"
      class:active={viewerState.controlScheme === 'trackball'}
      onclick={onTrackball}
    >Trackball</button>

    <button
      id="inverse-trackball-controls"
      class="control-button"
      class:active={viewerState.controlScheme === 'inverse-trackball'}
      onclick={onInverseTrackball}
    >Inverse Trackball</button>

    <button
      id="arcball-controls"
      class="control-button"
      class:active={viewerState.controlScheme === 'arcball'}
      onclick={onArcball}
    >Arcball</button>
  </div>

  <!-- Existing Rotation Center Behavior buttons stay here. -->
</details>
```

Do not expose the existing unused `cloudcompare` control.

- [ ] **Step 5: Remove legacy mode shortcuts from the global keyboard handler**

Delete the normal global cases for:

```ts
case 't':
case 'o':
case 'i':
case 'k':
case 'w':
```

Keep the Set Rotation Center to Origin button in the Controls tab; only the `W` shortcut is removed.

Gate legacy up-vector actions so Standard Orbit cannot be changed accidentally:

```ts
case 'x':
case 'y':
case 'z':
  if (this.controlType !== 'orbit') {
    const axes: Record<string, THREE.Vector3> = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    };
    this.setUpVector(axes[e.key.toLowerCase()]);
    e.preventDefault();
  }
  break;

case 'l':
  if (this.controlType === 'arcball') {
    this.arcballInvertRotation = !this.arcballInvertRotation;
    const arc = this.controls as any;
    arc.invertRotation = this.arcballInvertRotation;
    this.showStatus(
      `Arcball handedness: ${this.arcballInvertRotation ? 'Inverted' : 'Normal'}`
    );
    e.preventDefault();
  }
  break;
```

Do not add OrbitControls key listeners.

- [ ] **Step 6: Make Orbit status wording user-facing**

In `controlSchemeSwitcher.ts`, keep the function name for compatibility but change the message:

```ts
console.log('🔄 Switching to Standard OrbitControls');
host.controlType = 'orbit';
host.initializeControls();
host.updateControlStatus();
host.showStatus('Switched to Standard Orbit');
```

Keep the existing control-button active-state update logic because the IDs remain unchanged.

- [ ] **Step 7: Update the static Help in `engine/index.html`**

The Help section must list:

```html
<div class="shortcut-item">
  <span class="shortcut-key">Left drag</span>
  <span class="shortcut-desc">Orbit</span>
</div>
<div class="shortcut-item">
  <span class="shortcut-key">Middle drag / Mouse wheel</span>
  <span class="shortcut-desc">Zoom</span>
</div>
<div class="shortcut-item">
  <span class="shortcut-key">Right drag</span>
  <span class="shortcut-desc">Pan</span>
</div>
<div class="shortcut-item">
  <span class="shortcut-key">Double-click</span>
  <span class="shortcut-desc">Set rotation center</span>
</div>
<div class="shortcut-item">
  <span class="shortcut-key">Shift + Double-click</span>
  <span class="shortcut-desc">Measure from rotation center</span>
</div>
```

Keep `F` and `R`. Remove Help entries for `T`, `O`, `I`, `K`, and `W`.

- [ ] **Step 8: Bring the stale keyboard unit test in line with runtime behavior**

In `engine/test/browser/mainVisualizerInteraction.test.ts`, replace the conceptual control-mode shortcut map with the current primary navigation keys:

```ts
const navigationShortcuts = {
  KeyF: 'fitCamera',
  KeyR: 'resetCamera',
};

assert.deepStrictEqual(Object.keys(navigationShortcuts).sort(), ['KeyF', 'KeyR']);
```

Keep non-navigation shortcut tests separate instead of mixing them with camera-engine switching.

- [ ] **Step 9: Run UI, navigation, and Svelte checks**

```bash
cd engine
pnpm exec playwright test test/controls-camera-tabs.spec.ts test/orbit-navigation.spec.ts --project=chromium
pnpm run check
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add engine/src/components/ControlsTabTop.svelte engine/src/controlSchemeSwitcher.ts engine/src/main.ts engine/index.html engine/test/controls-camera-tabs.spec.ts engine/test/orbit-navigation.spec.ts engine/test/browser/mainVisualizerInteraction.test.ts
git commit -m "feat: simplify navigation UI around standard orbit"
```

---

## Task 4: Prove camera presets and legacy switching remain synchronized

**Files:**
- Modify: `engine/test/orbit-navigation.spec.ts`
- Modify only if a regression is exposed: `engine/src/cameraViews.ts`, `engine/src/main.ts`

**Interfaces:**
- Consumes: `applyCameraPreset(host, preset)`, `setCameraPosition(host, x, y, z)`, `initializeControls()`.
- Produces: no new public API; regression guarantees only.

- [ ] **Step 1: Add a preset/XYZ synchronization regression**

In `engine/test/orbit-navigation.spec.ts`, use the Camera tab to apply one axis preset and one ISO preset. For each preset:

```ts
const before = await cameraState(page);
// Click the preset button by its existing data/aria selector.
const after = await cameraState(page);

expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
expect(Math.abs(after.distance - before.distance)).toBeLessThan(1e-4);
```

Then edit one XYZ numeric field and assert:

```ts
expect(delta3(afterXYZ.target, after.target)).toBeLessThan(1e-6);
expect(delta3(afterXYZ.position, after.position)).toBeGreaterThan(1e-4);
```

Immediately perform an LMB orbit. The first drag must continue smoothly from the programmed camera state; assert there is no discontinuous target or distance jump.

The current `cameraViews.ts` already funnels these operations through:

```ts
host.controls.update();
host.updateCameraMatrix();
host.updateCameraControlsPanel();
host.requestRender();
```

so no production change is expected for this subcase.

- [ ] **Step 2: Add legacy → Standard Orbit state-preservation coverage**

Open Advanced Navigation and capture:

```ts
const beforeSwitch = await page.evaluate(() => {
  const v: any = (window as any).visualizer;
  return {
    position: v.camera.position.toArray(),
    target: v.controls.target.toArray(),
    up: v.camera.up.toArray(),
    fov: v.camera.fov,
    near: v.camera.near,
    far: v.camera.far,
  };
});
```

Switch to Trackball, then back to Standard Orbit, and assert every captured field remains within numerical tolerance.

Also assert after returning:

```ts
expect((window as any).visualizer.controls.enableDamping).toBe(false);
expect((window as any).visualizer.controls.screenSpacePanning).toBe(true);
```

Repeat the state-preservation transition for Inverse Trackball and Arcball.

- [ ] **Step 3: Run the regression before changing camera integration code**

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts --project=chromium
```

Expected: the recovered `cameraViews.ts` synchronization should pass. Any failure must be traced to a missing `controls.update()` or state restoration in the exact failing path; do not redesign camera presets.

- [ ] **Step 4: If the test exposes stale control state, fix only the synchronization boundary**

The allowed fix shape is:

```ts
host.camera.position.copy(...);
host.camera.lookAt(host.controls.target);
host.controls.update();
host.updateCameraMatrix();
host.updateCameraControlsPanel();
host.requestRender();
```

Do not create duplicate target state or special VS Code camera state.

- [ ] **Step 5: Re-run the full focused browser set**

```bash
cd engine
pnpm exec playwright test   test/orbit-navigation.spec.ts   test/point-picking.spec.ts   test/controls-camera-tabs.spec.ts   --project=chromium
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Always commit the new regression coverage. Include production files only if they were required by the failing test:

```bash
git add engine/test/orbit-navigation.spec.ts
git add engine/src/cameraViews.ts engine/src/main.ts 2>/dev/null || true
git commit -m "test: protect camera state across navigation changes"
```

---

## Task 5: Lock the VS Code custom-editor integration and perform host verification

**Files:**
- Modify: `src/test/suite/pointCloudEditorProviderAdvanced.test.ts`
- Verify unchanged: `src/extension.ts`
- Verify unchanged: `src/pointCloudEditorProvider.ts`

**Interfaces:**
- Consumes: existing custom editor registration `plyViewer.plyEditor`, existing webview CSP/resource generation, existing `webviewReady` gate.
- Produces: no new protocol or extension API.

- [ ] **Step 1: Update the extension-host test's stale navigation default**

In `src/test/suite/pointCloudEditorProviderAdvanced.test.ts`, change the conceptual config fixture from:

```ts
'plyViewer.cameraControls': { type: 'string', default: 'trackball' },
```

to:

```ts
'plyViewer.cameraControls': { type: 'string', default: 'orbit' },
```

Do not add a real contributed VS Code setting unless the extension already exposes one; this test fixture remains descriptive.

- [ ] **Step 2: Keep and strengthen the retain-context assertion**

The suite already models:

```ts
const webviewOptions = {
  enableScripts: true,
  retainContextWhenHidden: true,
  localResourceRoots: [],
};
```

Add an assertion that the intended custom-editor lifecycle for the navigation work is retained:

```ts
assert.strictEqual(
  webviewOptions.retainContextWhenHidden,
  true,
  '3D camera and GPU scene must remain alive while the custom editor tab is hidden'
);
```

Do not modify `src/extension.ts`; it already registers:

```ts
webviewOptions: {
  retainContextWhenHidden: true,
}
```

- [ ] **Step 3: Compile and run the extension-host regression suite**

From repo root:

```bash
pnpm run compile:all
pnpm test
```

Expected: PASS. This verifies extension activation/custom editor registration and catches CSP/resource/message lifecycle regressions that browser-only Playwright does not cover.

- [ ] **Step 4: Verify production host files contain no navigation-specific host changes**

Check the diff:

```bash
git diff -- src/extension.ts src/pointCloudEditorProvider.ts
```

Expected: no diff.

If a previous task accidentally added any of the following, remove it before continuing:

- new navigation `postMessage` types;
- broader CSP permissions;
- global webview `contextmenu` suppression;
- `setState()` camera persistence added solely for navigation;
- extension-host mouse/pointer forwarding.

- [ ] **Step 5: Build the extension bundle**

Run:

```bash
pnpm run compile
cd engine && pnpm run check && cd ..
```

Expected: webpack and Svelte checks pass.

- [ ] **Step 6: Run the real VS Code custom-editor smoke check**

After compiling, open an Extension Development Host using this checkout. If the `code` CLI is available:

```bash
code --extensionDevelopmentPath="$PWD" --new-window testfiles/open3d/sample_mesh.ply
```

Otherwise launch the repository's existing VS Code Extension Development Host configuration and open `testfiles/open3d/sample_mesh.ply` with **3D Visualizer**.

Verify in the actual VS Code webview:

1. Standard Orbit is active immediately.
2. LMB drag orbits.
3. MMB drag dollies.
4. Mouse wheel dollies.
5. RMB drag pans and **does not open the VS Code webview context menu**.
6. Normal double-click sets the pivot without translating the camera.
7. Shift + double-click creates a measurement without changing the pivot.
8. `F` fits and `R` resets while focus is in the viewer.
9. Focus a Camera numeric input; `F` and `R` must type/be ignored as appropriate and must not move the camera.
10. Switch to another editor tab and back; camera position and pivot are unchanged.
11. Open Advanced Navigation, switch to each retained legacy mode, return to Standard Orbit, and confirm there is no camera jump.
12. Close and reopen the custom editor; it initializes cleanly in Standard Orbit.

If RMB still opens the VS Code context menu despite OrbitControls' native handler, add a **canvas-only** fallback in `main.ts` during viewer initialization:

```ts
this.renderer.domElement.addEventListener('contextmenu', event => {
  event.preventDefault();
});
```

Do not attach this listener to `document` or `body`.

- [ ] **Step 7: If the VS Code RMB fallback was required, add a browser regression for its scope**

Assert canvas context menus are prevented while a non-canvas element is not globally intercepted. Then rerun:

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts --project=chromium
```

- [ ] **Step 8: Commit Task 5**

```bash
git add src/test/suite/pointCloudEditorProviderAdvanced.test.ts engine/src/main.ts engine/test/orbit-navigation.spec.ts
git commit -m "test: verify orbit navigation in VS Code webview"
```

If `engine/src/main.ts` did not need the VS Code fallback, omit it from the commit.

---

## Task 6: Full regression, packaging, and release-candidate verification

**Files:**
- No intended production changes.
- Update tests only if a test itself is demonstrably stale and the behavior is already defined by the spec.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a verified implementation branch ready for code review/merge.

- [ ] **Step 1: Run all focused navigation tests**

```bash
cd engine
pnpm exec playwright test   test/orbit-navigation.spec.ts   test/point-picking.spec.ts   test/controls-camera-tabs.spec.ts   test/zoom-after-rotate.spec.ts   test/rotation-drift-check.spec.ts   --project=chromium
```

Expected: PASS. Legacy-specific tests must still pass because legacy controls remain supported.

- [ ] **Step 2: Run the complete engine browser suite**

```bash
cd engine
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run root extension tests and static checks**

From repo root:

```bash
pnpm run compile:all
pnpm run lint
pnpm run format:check
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for prohibited architecture drift**

Run:

```bash
git diff recovered/voxel-camera-ui...HEAD --   engine/src   engine/index.html   engine/test   src
```

Confirm:

- no custom standard navigation controller was added;
- no navigation webview protocol was added;
- CSP is unchanged;
- `retainContextWhenHidden: true` remains;
- `cameraViews.ts` still has one target and calls `controls.update()`;
- legacy control implementation files were not deleted;
- Standard Orbit is the only default.

- [ ] **Step 5: Build/package using the repository's recovered VSIX workflow**

Push the feature branch and run the existing `.github/workflows/build-recovered-vsix.yml` build path, which already compiles this historical tree with the shared dependency layout.

Expected workflow steps:
- dependency install;
- compile;
- VSIX package;
- artifact upload.

For feature-branch verification, do not overwrite the protected recovery release/tag. Either run packaging without its release-publishing step or publish a separate test artifact/tag only after review.

- [ ] **Step 6: Install the generated VSIX in a clean VS Code window and repeat the short UX smoke**

Minimum release-candidate smoke:

- open a PLY;
- LMB orbit;
- MMB/wheel zoom;
- RMB pan with no context menu;
- double-click pivot;
- F Fit;
- Camera preset;
- hide/reveal tab;
- legacy mode → Standard Orbit.

- [ ] **Step 7: Commit any final test-only cleanup and stop for review**

If no changes were needed, do not create an empty commit. Otherwise:

```bash
git add <only-the-verified-test-or-doc-files>
git commit -m "test: complete orbit navigation regression coverage"
```

Then invoke Superpowers code review before merge.

---

## Expected Implementation Delta

The intended production delta is deliberately small:

1. one new Standard Orbit configuration helper;
2. two default values changed from Trackball/move-camera to Orbit/keep-camera;
3. one implicit empty-space Fit branch removed;
4. legacy navigation buttons moved under a collapsed Advanced section;
5. stale mode-switch keyboard shortcuts removed;
6. static Help updated;
7. no VS Code host protocol or CSP changes.

Most of the implementation effort is regression coverage because the desired UX already exists in Three.js and the recovered project already has point picking, camera presets, custom-editor lifecycle handling, and webview packaging.

## Self-Review Mapping

- Spec §§4, 9, 10 → Task 1.
- Spec §5 → Task 2.
- Spec §§6–7 → Task 3.
- Spec §8 + control-state preservation → Task 4.
- Spec §14 VS Code requirements → Task 5.
- Spec §§12, 15 acceptance criteria → Tasks 1–6.
- No task introduces a custom CAD controller, new dependency, new webview message, CSP relaxation, or duplicate camera state.
