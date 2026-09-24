# Stable Orbit Pivot and View Cube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Standard Orbit rotate in one stable +Z-up navigation frame around the visual center target, and replace the current static orientation selector with a synchronized animated CSS 3D view cube.

**Architecture:** Standard Orbit keeps a single immutable navigation-up vector and one authoritative `controls.target`. Camera view directions become deterministic world-space definitions independent of prior camera roll. A Svelte CSS-3D view cube mirrors the camera and calls a small camera-view animator that moves only the camera around the existing target.

**Tech Stack:** TypeScript, Three.js r185 OrbitControls, Svelte 5, CSS 3D transforms, Playwright, VS Code extension-host tests.

**Spec:** `docs/superpowers/specs/2026-09-24-orbit-pivot-view-cube-design.md`

## Global Constraints

- Keep native Three.js OrbitControls as the Standard Orbit controller.
- Standard Orbit world-up is exactly `(0, 0, 1)`.
- Do not mutate Standard Orbit `camera.up` from camera presets.
- Preserve `controls.target` and camera-target distance during view-cube snaps.
- Keep double-click as the explicit operation that changes orbit target.
- Keep existing LMB/MMB/RMB/wheel/arrow-key OrbitControls interaction unchanged.
- Use axis labels on the view cube; do not introduce Front/Back semantic labels.
- No new extension-host messages, CSP changes, remote scripts, or second renderer.
- Keep `recovered/voxel-camera-ui` and `feature/orbitcontrols-navigation` untouched; implement on a new feature branch from the latter.

## Review Focus

1. **Preset history dependence:** +X selected after +Y must be byte-for-byte equivalent in camera direction/up to +X selected after +Z.
2. **Orbit target centering:** target projection must remain at canvas center after Fit, cube snaps, XYZ edits, and explicit pivot changes.
3. **Top/bottom singularities:** +Z/-Z snaps must not NaN, flip roll unpredictably, or change target/distance.
4. **Animation interruption:** pointer/wheel/keyboard input during a cube snap must cancel the animation without a camera jump.
5. **VS Code lifecycle:** hiding/revealing the editor and switching legacy controls must not leave cube animation or Orbit listeners active.

---

## File Structure

### Create

- `engine/src/cameraOrientation.ts` — immutable navigation frame, deterministic axis/edge/corner view definitions, camera-direction helpers.
- `engine/src/CameraViewAnimator.ts` — short cancellable target-preserving camera snap animation.
- `engine/src/components/ViewCube.svelte` — CSS 3D cube presentation and click hotspots.
- `engine/test/view-cube.spec.ts` — browser regression coverage for orientation cube, deterministic snaps, synchronization, and animation cancellation.

### Modify

- `engine/src/orbitNavigation.ts` — apply stable +Z navigation-up contract before/with Standard Orbit.
- `engine/src/main.ts` — set camera up before Standard Orbit creation; expose/cancel view animation from real navigation input; keep target invariant.
- `engine/src/cameraViews.ts` — remove history-dependent `stableUpVector()`; delegate to deterministic orientation helpers/animator.
- `engine/src/components/CameraControlsPanel.svelte` — replace `ViewOrientationSelector` with `ViewCube`.
- `engine/src/components/ViewOrientationSelector.svelte` — delete after ViewCube parity is covered.
- `engine/test/orbit-navigation.spec.ts` — add fixed-up and target-projection invariants.
- `engine/test/controls-camera-tabs.spec.ts` — update Camera-tab selectors/help expectations.
- `.github/workflows/test-orbit-navigation.yml` — add `view-cube.spec.ts` to the focused feature gate.

---

## Task 1: Pin the Standard Orbit frame and prove the real pivot

**Files:**
- Create: `engine/src/cameraOrientation.ts`
- Modify: `engine/src/main.ts`
- Modify: `engine/src/orbitNavigation.ts`
- Test: `engine/test/orbit-navigation.spec.ts`

**Interfaces:**
- Produces: `NAVIGATION_UP: THREE.Vector3`
- Produces: `resetStandardOrbitUp(camera: THREE.PerspectiveCamera): void`
- Produces test helper behavior: projection of `controls.target` into canvas coordinates.

- [ ] **Step 1: Write the failing fixed-up regression**

Add to `engine/test/orbit-navigation.spec.ts`:

```ts
test('Standard Orbit keeps one +Z world-up across camera interaction', async ({ page }) => {
  await loadSampleMesh(page);

  await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    v.camera.up.set(0.3, 0.4, 0.5).normalize();
    v.initializeControls();
  });

  const up = await page.evaluate(() =>
    (window as any).visualizer.camera.up.toArray()
  );

  expect(up[0]).toBeCloseTo(0, 8);
  expect(up[1]).toBeCloseTo(0, 8);
  expect(up[2]).toBeCloseTo(1, 8);
});
```

- [ ] **Step 2: Write the failing target-at-screen-center regression**

Add a helper:

```ts
async function targetScreenOffset(page: Page) {
  return page.evaluate(() => {
    const v: any = (window as any).visualizer;
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();

    v.camera.updateMatrixWorld(true);
    const p = v.controls.target.clone().project(v.camera);

    return {
      dx: ((p.x + 1) * 0.5) * rect.width - rect.width / 2,
      dy: ((1 - p.y) * 0.5) * rect.height - rect.height / 2,
    };
  });
}
```

Then:

```ts
test('Orbit target is the visual center after Fit and explicit pivot', async ({ page }) => {
  await loadSampleMesh(page);

  const afterFit = await targetScreenOffset(page);
  expect(Math.hypot(afterFit.dx, afterFit.dy)).toBeLessThan(1);

  // Reuse the deterministic projected-point double-click helper already used
  // by this file, then wait for damping to settle.
  await doubleClickKnownPoint(page);
  await waitForCameraSettled(page);

  const afterPivot = await targetScreenOffset(page);
  expect(Math.hypot(afterPivot.dx, afterPivot.dy)).toBeLessThan(1);
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts --project=chromium
```

Expected: the fixed-up test fails with the current mutable camera-up behavior.

- [ ] **Step 4: Create the navigation-frame utility**

Create `engine/src/cameraOrientation.ts`:

```ts
import * as THREE from 'three';

export const NAVIGATION_UP = new THREE.Vector3(0, 0, 1);

export function resetStandardOrbitUp(camera: THREE.PerspectiveCamera): void {
  camera.up.copy(NAVIGATION_UP);
}
```

- [ ] **Step 5: Apply +Z up before OrbitControls owns the camera**

In `initializeControls()`, immediately before constructing Standard OrbitControls:

```ts
resetStandardOrbitUp(this.camera);
this.controls = new OrbitControls(this.camera, this.renderer.domElement);
configureStandardOrbitControls(this.controls as OrbitControls);
```

Do not apply this reset to Trackball, Inverse Trackball, Arcball, or CloudCompare modes.

- [ ] **Step 6: Re-run focused test**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/src/cameraOrientation.ts engine/src/main.ts engine/src/orbitNavigation.ts engine/test/orbit-navigation.spec.ts
git commit -m "fix: stabilize Standard Orbit navigation frame"
```

---

## Task 2: Make every camera preset deterministic

**Files:**
- Modify: `engine/src/cameraOrientation.ts`
- Modify: `engine/src/cameraViews.ts`
- Test: `engine/test/orbit-navigation.spec.ts`
- Test: `engine/test/controls-camera-tabs.spec.ts`

**Interfaces:**
- Consumes: `NAVIGATION_UP`
- Produces:
  - `CameraViewId`
  - `CAMERA_VIEW_DIRECTIONS`
  - `getViewDirection(id: CameraViewId): THREE.Vector3`
  - `applyDeterministicCameraView(host, id): void`

- [ ] **Step 1: Write history-independence tests**

For each axis preset, run two different predecessor views before applying the same final view:

```ts
for (const preset of ['positive-x', 'negative-x', 'positive-y', 'negative-y', 'positive-z', 'negative-z'] as const) {
  test(`${preset} is independent of previous camera preset`, async ({ page }) => {
    await loadSampleMesh(page);

    await clickPreset(page, 'positive-x');
    await clickPreset(page, preset);
    const first = await cameraState(page);

    await clickPreset(page, 'negative-y');
    await clickPreset(page, preset);
    const second = await cameraState(page);

    expect(delta3(first.position, second.position)).toBeLessThan(1e-5);
    expect(delta3(first.up, second.up)).toBeLessThan(1e-5);
    expect(delta3(first.target, second.target)).toBeLessThan(1e-6);
  });
}
```

- [ ] **Step 2: Run RED**

Expected: at least +X/+Y history combinations fail because `stableUpVector()` inherits prior `camera.up`.

- [ ] **Step 3: Replace inherited-up math with world-space view directions**

Expand `cameraOrientation.ts`:

```ts
export type CameraViewId =
  | 'positive-x' | 'negative-x'
  | 'positive-y' | 'negative-y'
  | 'positive-z' | 'negative-z'
  | 'iso-positive' | 'iso-negative';

const DIRECTIONS: Record<CameraViewId, THREE.Vector3> = {
  'positive-x': new THREE.Vector3(1, 0, 0),
  'negative-x': new THREE.Vector3(-1, 0, 0),
  'positive-y': new THREE.Vector3(0, 1, 0),
  'negative-y': new THREE.Vector3(0, -1, 0),
  'positive-z': new THREE.Vector3(0, 0, 1),
  'negative-z': new THREE.Vector3(0, 0, -1),
  'iso-positive': new THREE.Vector3(1, -1, 1).normalize(),
  'iso-negative': new THREE.Vector3(-1, 1, 1).normalize(),
};

export function getViewDirection(id: CameraViewId): THREE.Vector3 {
  return DIRECTIONS[id].clone().normalize();
}
```

- [ ] **Step 4: Implement pole-safe snapping without mutating camera.up**

For +Z/-Z use a fixed tiny horizontal component solely to define azimuth while preserving a visually exact top/bottom result:

```ts
const POLE_EPSILON = 1e-7;

export function poleSafeDirection(direction: THREE.Vector3): THREE.Vector3 {
  const d = direction.clone().normalize();
  if (Math.abs(Math.abs(d.z) - 1) < 1e-10) {
    d.x = POLE_EPSILON;
    d.normalize();
  }
  return d;
}
```

Then position the camera at:

```ts
camera.position.copy(target).addScaledVector(direction, distance);
camera.up.copy(NAVIGATION_UP);
controls.update();
```

Delete `stableUpVector()`.

- [ ] **Step 5: Verify target projection and distance preservation for all presets**

Add assertions:

```ts
expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
expect(Math.abs(after.distance - before.distance)).toBeLessThan(1e-4);
expect(Math.hypot(center.dx, center.dy)).toBeLessThan(1);
```

- [ ] **Step 6: Run tests**

```bash
cd engine
pnpm exec playwright test test/orbit-navigation.spec.ts test/controls-camera-tabs.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/src/cameraOrientation.ts engine/src/cameraViews.ts engine/test/orbit-navigation.spec.ts engine/test/controls-camera-tabs.spec.ts
git commit -m "fix: make camera presets deterministic"
```

---

## Task 3: Add cancellable camera-view animation

**Files:**
- Create: `engine/src/CameraViewAnimator.ts`
- Modify: `engine/src/cameraViews.ts`
- Modify: `engine/src/main.ts`
- Test: `engine/test/view-cube.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface CameraViewAnimationHost {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void };
  requestRender(): void;
}

export class CameraViewAnimator {
  animateToDirection(host: CameraViewAnimationHost, direction: THREE.Vector3, durationMs?: number): void;
  cancel(): void;
  get isAnimating(): boolean;
}
```

- [ ] **Step 1: Write target/distance preservation animation tests**

Create `engine/test/view-cube.spec.ts` with:

```ts
test('animated view snap preserves target and camera distance', async ({ page }) => {
  await loadSampleMesh(page);
  const before = await cameraState(page);

  await page.getByRole('button', { name: 'View from +X' }).click();
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

  const after = await cameraState(page);
  expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
  expect(Math.abs(after.distance - before.distance)).toBeLessThan(1e-4);
});
```

- [ ] **Step 2: Write interruption test**

```ts
test('manual orbit cancels an active view snap without jumping', async ({ page }) => {
  await loadSampleMesh(page);
  await page.getByRole('button', { name: 'View from -Y' }).click();

  await page.waitForFunction(() => (window as any).visualizer.cameraViewAnimator.isAnimating);
  await dragCanvas(page, 'left', 30, 0);

  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);
  const state = await cameraState(page);
  expect(state.position.every(Number.isFinite)).toBe(true);
});
```

- [ ] **Step 3: Run RED**

Expected: animator does not exist.

- [ ] **Step 4: Implement animator**

Use direction interpolation around the fixed target:

```ts
const startOffset = camera.position.clone().sub(target);
const distance = startOffset.length();
const from = startOffset.normalize();
const to = poleSafeDirection(direction);

const q = new THREE.Quaternion().setFromUnitVectors(from, to);
const identity = new THREE.Quaternion();

function frame(now: number) {
  const t = Math.min((now - startTime) / durationMs, 1);
  const eased = t * t * (3 - 2 * t);
  const partial = identity.clone().slerp(q, eased);
  const dir = from.clone().applyQuaternion(partial).normalize();

  camera.position.copy(target).addScaledVector(dir, distance);
  camera.up.copy(NAVIGATION_UP);
  controls.update();
  host.requestRender();

  if (t < 1 && !cancelled) requestAnimationFrame(frame);
}
```

Use one retained RAF id and a generation/cancellation token so a second snap cleanly supersedes the first.

- [ ] **Step 5: Cancel animation from real navigation input**

In `main.ts`, connect cancellation to OrbitControls `start` and wheel/keyboard paths:

```ts
this.controls.addEventListener('start', () => this.cameraViewAnimator.cancel());
```

Also cancel before explicit Fit, double-click pivot, Reset Camera, and XYZ edits.

- [ ] **Step 6: Run tests**

```bash
cd engine
pnpm exec playwright test test/view-cube.spec.ts test/orbit-navigation.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/src/CameraViewAnimator.ts engine/src/cameraViews.ts engine/src/main.ts engine/test/view-cube.spec.ts
git commit -m "feat: animate deterministic camera view snaps"
```

---

## Task 4: Replace the static selector with a synchronized CSS 3D view cube

**Files:**
- Create: `engine/src/components/ViewCube.svelte`
- Modify: `engine/src/components/CameraControlsPanel.svelte`
- Delete: `engine/src/components/ViewOrientationSelector.svelte`
- Modify: `engine/src/state/viewer.svelte.js`
- Test: `engine/test/view-cube.spec.ts`
- Test: `engine/test/controls-camera-tabs.spec.ts`

**Interfaces:**
- Consumes: `CameraViewId`, `CameraViewAnimator`
- Produces DOM structure with:
  - `data-view-cube`
  - `data-view-face="+x"` etc.
  - edge/corner hotspots with stable `data-view-direction` values.

- [ ] **Step 1: Write the failing DOM and synchronization test**

```ts
test('Camera tab renders a six-face CSS 3D view cube', async ({ page }) => {
  await page.click('[data-tab="camera"]');

  await expect(page.locator('[data-view-cube]')).toBeVisible();
  for (const face of ['+x', '-x', '+y', '-y', '+z', '-z']) {
    await expect(page.locator(`[data-view-face="${face}"]`)).toHaveCount(1);
  }
});
```

Then orbit the main camera and assert the cube transform changes:

```ts
const before = await cubeTransform(page);
await dragCanvas(page, 'left', 80, -30);
await waitForCameraSettled(page);
const after = await cubeTransform(page);
expect(after).not.toBe(before);
```

- [ ] **Step 2: Run RED**

Expected: `[data-view-cube]` not found.

- [ ] **Step 3: Build the six-face cube**

Adapt the DeSandro structure:

```svelte
<div class="view-cube-scene">
  <div class="view-cube" style:transform={cubeTransform} data-view-cube>
    <button class="face face-pos-x" data-view-face="+x">+X</button>
    <button class="face face-neg-x" data-view-face="-x">−X</button>
    <button class="face face-pos-y" data-view-face="+y">+Y</button>
    <button class="face face-neg-y" data-view-face="-y">−Y</button>
    <button class="face face-pos-z" data-view-face="+z">+Z</button>
    <button class="face face-neg-z" data-view-face="-z">−Z</button>
  </div>
</div>
```

Use `transform-style: preserve-3d`, CSS perspective, six rotated/translated faces, and a short CSS transform transition for visual synchronization.

- [ ] **Step 4: Mirror the camera orientation**

Derive the cube transform from the inverse camera quaternion, converted to a CSS `matrix3d(...)`.

Do not mutate the main camera when computing cube display state.

Update the reactive cube orientation from the existing viewer camera-state tick/change path instead of installing a second render loop.

- [ ] **Step 5: Wire face clicks**

Each face button calls:

```ts
host.cameraViewAnimator.animateToDirection(
  host,
  getViewDirection(viewId)
);
```

- [ ] **Step 6: Add edge and corner hotspots**

Add transparent but keyboard-focusable hotspots:
- 12 edges → normalized two-axis direction;
- 8 corners → normalized three-axis direction.

Give each an accessible label, e.g. `View from +X +Y +Z corner`.

- [ ] **Step 7: Highlight nearest orientation**

Use the normalized camera offset:

```ts
camera.position.clone().sub(controls.target).normalize()
```

and dot products against face/edge/corner directions. Apply `.active` to the highest match above a threshold.

- [ ] **Step 8: Update Camera tab tests**

Remove selectors tied to the old pseudo-cube buttons and assert:
- view cube visible;
- six face labels present;
- current orientation highlight updates;
- XYZ/FOV controls still render below it.

- [ ] **Step 9: Run tests**

```bash
cd engine
pnpm exec playwright test test/view-cube.spec.ts test/controls-camera-tabs.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add engine/src/components/ViewCube.svelte engine/src/components/CameraControlsPanel.svelte engine/src/state/viewer.svelte.js engine/test/view-cube.spec.ts engine/test/controls-camera-tabs.spec.ts
git rm engine/src/components/ViewOrientationSelector.svelte
git commit -m "feat: add synchronized CSS 3D camera view cube"
```

---

## Task 5: Protect the navigation invariant across all camera actions

**Files:**
- Modify: `engine/src/cameraConvention.ts`
- Modify: `engine/src/main.ts`
- Modify: `engine/src/cameraViews.ts`
- Test: `engine/test/orbit-navigation.spec.ts`
- Test: `engine/test/view-cube.spec.ts`

**Interfaces:**
- Consumes: `NAVIGATION_UP`, `CameraViewAnimator.cancel()`

- [ ] **Step 1: Add a regression for every action that can currently mutate camera orientation**

Test this sequence:

```ts
Fit
→ +X cube face
→ edit camera X
→ double-click pivot
→ Reset Camera
→ return to Standard Orbit
```

After each action assert:
- all camera values finite;
- Standard Orbit `camera.up === [0,0,1]`;
- target projects to center for non-pan actions;
- target/distance changes only where the action contract allows.

- [ ] **Step 2: Audit `cameraConvention.ts`**

The existing OpenCV/OpenGL helpers directly change `camera.up`. Under Standard Orbit, that would reintroduce the bug.

Change their Standard Orbit path so they do **not** leave a mutated persistent `camera.up`. Use deterministic camera pose/direction plus `NAVIGATION_UP`.

If a convention requires an incompatible persistent up axis, keep that behavior only in legacy/advanced controls and explicitly re-establish `NAVIGATION_UP` when Standard Orbit is selected again.

- [ ] **Step 3: Cancel view animation before all direct camera mutations**

Call `cameraViewAnimator.cancel()` before:
- Fit;
- Reset Camera;
- double-click pivot;
- direct camera-position dialog commits;
- direct camera-rotation dialog commits;
- camera convention changes.

- [ ] **Step 4: Run focused browser suite**

```bash
cd engine
pnpm exec playwright test \
  test/orbit-navigation.spec.ts \
  test/view-cube.spec.ts \
  test/controls-camera-tabs.spec.ts \
  test/point-picking.spec.ts \
  --project=chromium
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/cameraConvention.ts engine/src/main.ts engine/src/cameraViews.ts engine/test/orbit-navigation.spec.ts engine/test/view-cube.spec.ts
git commit -m "fix: preserve Orbit frame across camera actions"
```

---

## Task 6: Full VS Code verification and package

**Files:**
- Modify: `.github/workflows/test-orbit-navigation.yml`
- Test: existing `src/test/suite/pointCloudEditorProviderAdvanced.test.ts`
- Test: all feature browser specs.

**Interfaces:** None; this is the release gate.

- [ ] **Step 1: Add the view-cube test to the focused CI gate**

Ensure:

```bash
pnpm exec playwright test \
  test/orbit-navigation.spec.ts \
  test/view-cube.spec.ts \
  test/point-picking.spec.ts \
  test/controls-camera-tabs.spec.ts \
  --project=chromium
```

runs before the broad browser suite.

- [ ] **Step 2: Run compile/lint/build**

```bash
pnpm run compile:all
pnpm run lint
git diff --check origin/feature/orbitcontrols-navigation...HEAD
cd engine && pnpm run build
```

Expected: all PASS.

- [ ] **Step 3: Run browser tests**

Run the focused feature suite, then the same broad browser-suite baseline policy used by the current green Orbit branch.

Expected: PASS.

- [ ] **Step 4: Run VS Code extension-host tests**

```bash
xvfb-run -a pnpm test
```

Expected: PASS, including custom editor persistence and webview integration.

- [ ] **Step 5: Package VSIX**

```bash
mkdir -p artifacts
pnpm dlx @vscode/vsce package --out artifacts/ply-visualizer-orbit-view-cube.vsix
sha256sum artifacts/ply-visualizer-orbit-view-cube.vsix | tee artifacts/SHA256SUMS
```

- [ ] **Step 6: Manual interaction smoke checklist**

In the real VS Code webview:
1. Load a non-symmetric PLY.
2. Fit.
3. Orbit with LMB from several starting angles.
4. Verify the apparent orbit reference remains the screen-centered target.
5. Click +X, +Y, +Z, -X, -Y, -Z in different orders and verify no preset inherits roll.
6. Orbit after each face snap and verify horizontal drag remains predictable.
7. Click an edge and a corner; verify smooth target-preserving snap.
8. Interrupt a snap with LMB and with wheel; verify no jump.
9. Pan with arrows, then orbit; verify target moves with pan and remains centered.
10. Switch VS Code tabs away/back; verify cube and camera remain synchronized.

- [ ] **Step 7: Commit CI/package changes**

```bash
git add .github/workflows/test-orbit-navigation.yml
git commit -m "ci: verify Orbit pivot and view cube"
```

---

## Self-Review

### Spec coverage

- Stable Orbit frame: Task 1.
- Deterministic presets: Task 2.
- Smooth target-preserving animation: Task 3.
- CSS 3D cube: Task 4.
- Face/edge/corner interactions: Task 4.
- Camera-action invariant audit: Task 5.
- VS Code constraints and packaging: Task 6.
- Explicit pivot behavior remains: Tasks 1 and 5.

### Placeholder scan

No TBD/TODO/FIXME or unspecified implementation steps remain.

### Type consistency

- `NAVIGATION_UP` and `CameraViewId` originate in `cameraOrientation.ts`.
- `CameraViewAnimator` owns snap lifecycle and cancellation.
- `ViewCube.svelte` consumes orientation helpers and the animator through the viewer host.
- Tests use the existing `window.visualizer` test-access pattern.

### Review-focus coverage

All five Review Focus items have explicit tests in Tasks 1, 2, 3, 5, or 6.
