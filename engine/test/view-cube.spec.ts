import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function loadSampleMesh(page: Page) {
  await page.goto('/3d-visualizer/');
  await page.waitForSelector('#three-canvas');
  await page.waitForFunction(() => Boolean((window as any).visualizer?.controls));
  await page.click('[data-tab="files"]');
  const plyPath = path.resolve('../testfiles/open3d/sample_mesh.ply');
  await page.locator('#hiddenFileInput').setInputFiles(plyPath);
  const loading = page.locator('#loading');
  if (await loading.isVisible()) {
    await expect(loading).toBeHidden({ timeout: 60000 });
  }
  await page.waitForTimeout(300);
  await page.click('[data-tab="camera"]');
}

async function cameraState(page: Page) {
  return page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      position: v.camera.position.toArray(),
      target: v.controls.target.toArray(),
      distance: v.camera.position.distanceTo(v.controls.target),
      up: v.camera.up.toArray(),
    };
  });
}

function viewDirectionFromName(name: string): string {
  return name
    .replace(/^View from\s+/, '')
    .replace(/\s+(edge|corner)$/, '')
    .replace(/−/g, '-');
}

async function invokeView(page: Page, name: string) {
  const direction = viewDirectionFromName(name);
  await page
    .locator(`[data-view-direction="${direction}"]`)
    .first()
    .evaluate((el: HTMLButtonElement) => el.click());
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);
  await page.waitForTimeout(100);
}

async function faceAtCubeCenter(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const scene = document.querySelector('[data-view-cube-scene]') as HTMLElement | null;
    if (!scene) return null;
    const rect = scene.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return (el?.closest('[data-view-face]') as HTMLElement | null)?.dataset.viewFace ?? null;
  });
}

function delta3(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('Camera tab renders one six-plane CSS 3D cube with invisible edge/corner hit regions', async ({ page }) => {
  await loadSampleMesh(page);

  await expect(page.locator('[data-view-cube]')).toBeVisible();
  await expect(page.locator('[data-view-face]')).toHaveCount(6);
  const directionKinds = await page.evaluate(() => {
    const entries = [...document.querySelectorAll('[data-view-direction]')].map(el => ({
      direction: (el as HTMLElement).dataset.viewDirection ?? '',
      kind: (el as HTMLElement).dataset.viewKind ?? '',
    }));
    return {
      faces: [...new Set(entries.filter(entry => entry.kind === 'face').map(entry => entry.direction))],
      edges: [...new Set(entries.filter(entry => entry.kind === 'edge').map(entry => entry.direction))],
      corners: [...new Set(entries.filter(entry => entry.kind === 'corner').map(entry => entry.direction))],
    };
  });
  expect(directionKinds.faces).toHaveLength(6);
  expect(directionKinds.edges).toHaveLength(12);
  expect(directionKinds.corners).toHaveLength(8);

  const geometry = await page.evaluate(() => {
    const scene = document.querySelector('[data-view-cube-scene]') as HTMLElement;
    const cube = document.querySelector('[data-view-cube]') as HTMLElement;
    const faces = [...document.querySelectorAll('[data-view-face]')] as HTMLElement[];
    const hitRegions = [...document.querySelectorAll('.face-hit-cell')] as HTMLElement[];
    const sceneStyle = getComputedStyle(scene);
    const cubeStyle = getComputedStyle(cube);

    return {
      scene: {
        width: parseFloat(sceneStyle.width),
        height: parseFloat(sceneStyle.height),
        perspective: sceneStyle.perspective,
      },
      cube: {
        width: parseFloat(cubeStyle.width),
        height: parseFloat(cubeStyle.height),
        transformStyle: cubeStyle.transformStyle,
      },
      faces: faces.map(face => {
        const style = getComputedStyle(face);
        return {
          width: parseFloat(style.width),
          height: parseFloat(style.height),
          backfaceVisibility: style.backfaceVisibility,
          opacity: style.opacity,
        };
      }),
      hitRegions: hitRegions.map(hit => {
        const style = getComputedStyle(hit);
        return {
          opacity: style.opacity,
          backgroundColor: style.backgroundColor,
          borderWidth: style.borderWidth,
        };
      }),
    };
  });

  expect(geometry.scene.width).toBeCloseTo(136, 0);
  expect(geometry.scene.height).toBeCloseTo(136, 0);
  expect(parseFloat(geometry.scene.perspective)).toBeCloseTo(228, 0);
  expect(geometry.cube.transformStyle).toBe('preserve-3d');

  for (const face of geometry.faces) {
    expect(face.width).toBeCloseTo(76, 0);
    expect(face.height).toBeCloseTo(76, 0);
    expect(face.backfaceVisibility).toBe('hidden');
    expect(face.opacity).toBe('1');
  }

  for (const hit of geometry.hitRegions) {
    expect(hit.backgroundColor === 'rgba(0, 0, 0, 0)' || hit.backgroundColor === 'transparent').toBe(true);
    expect(hit.borderWidth).toBe('0px');
  }
});

for (const [label, id] of [
  ['View from +X', '+x'],
  ['View from −X', '-x'],
  ['View from +Y', '+y'],
  ['View from −Y', '-y'],
  ['View from +Z', '+z'],
  ['View from −Z', '-z'],
] as const) {
  test(`${label} puts the matching cube face at the gizmo center`, async ({ page }) => {
    await loadSampleMesh(page);
    await invokeView(page, label);
    expect(await faceAtCubeCenter(page)).toBe(id);
  });
}

test('animated view snap preserves target, distance, and +Z up', async ({ page }) => {
  await loadSampleMesh(page);
  const before = await cameraState(page);

  await invokeView(page, 'View from +X');

  const after = await cameraState(page);
  expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
  expect(Math.abs(after.distance - before.distance)).toBeLessThan(1e-4);
  expect(after.up[0]).toBeCloseTo(0, 8);
  expect(after.up[1]).toBeCloseTo(0, 8);
  expect(after.up[2]).toBeCloseTo(1, 8);
});

test('view cube mirrors manual orbit and manual orbit cancels a snap', async ({ page }) => {
  await loadSampleMesh(page);
  const cube = page.locator('[data-view-cube]');
  const before = await cube.getAttribute('style');

  const canvas = page.locator('#three-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.55;
  const y = box!.y + box!.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 80, y - 30, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);

  const after = await cube.getAttribute('style');
  expect(after).not.toBe(before);

  await page
    .locator('[data-view-direction="-Y"]')
    .first()
    .evaluate((el: HTMLButtonElement) => el.click());
  await page.waitForFunction(() => (window as any).visualizer.cameraViewAnimator.isAnimating);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 30, y, { steps: 4 });
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

  const state = await cameraState(page);
  expect(state.position.every(Number.isFinite)).toBe(true);
});

test('a visible front cube face accepts a real pointer click', async ({ page }) => {
  await loadSampleMesh(page);
  await invokeView(page, 'View from +Z');

  const face = page.locator('[data-view-kind="face"][data-view-direction="+Z"]').first();
  await expect(face).toBeVisible();
  await face.click();
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

  const state = await cameraState(page);
  expect(state.position.every(Number.isFinite)).toBe(true);
  expect(state.target.every(Number.isFinite)).toBe(true);
  expect(await faceAtCubeCenter(page)).toBe('+z');
});

test('cube stays inside its own narrow Camera-panel layout and help text begins below it', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await loadSampleMesh(page);

  const layout = await page.evaluate(() => {
    const wrap = document.querySelector('[data-view-cube-wrap]') as HTMLElement;
    const scene = document.querySelector('[data-view-cube-scene]') as HTMLElement;
    const hint = wrap.querySelector('.view-hint') as HTMLElement;
    const wrapRect = wrap.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();

    return {
      wrap: { left: wrapRect.left, right: wrapRect.right, top: wrapRect.top, bottom: wrapRect.bottom },
      scene: { left: sceneRect.left, right: sceneRect.right, top: sceneRect.top, bottom: sceneRect.bottom },
      hint: { left: hintRect.left, right: hintRect.right, top: hintRect.top, bottom: hintRect.bottom },
    };
  });

  expect(layout.scene.left).toBeGreaterThanOrEqual(layout.wrap.left - 0.5);
  expect(layout.scene.right).toBeLessThanOrEqual(layout.wrap.right + 0.5);
  expect(layout.hint.top).toBeGreaterThanOrEqual(layout.scene.bottom + 6);
});

test('capture narrow-panel isometric ViewCube visual reference', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await loadSampleMesh(page);
  await invokeView(page, 'View from +X -Y +Z corner');

  const artifactsDir = path.resolve('artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const wrap = page.locator('[data-view-cube-wrap]');
  await expect(wrap).toBeVisible();

  const diagnostics = await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    const cube = document.querySelector('[data-view-cube]') as HTMLElement;
    const scene = document.querySelector('[data-view-cube-scene]') as HTMLElement;
    const faces = [...document.querySelectorAll('[data-view-face]')] as HTMLElement[];

    return {
      camera: {
        position: v.camera.position.toArray(),
        target: v.controls.target.toArray(),
        up: v.camera.up.toArray(),
        quaternion: v.camera.quaternion.toArray(),
      },
      scene: {
        rect: scene.getBoundingClientRect().toJSON(),
        perspective: getComputedStyle(scene).perspective,
      },
      cube: {
        rect: cube.getBoundingClientRect().toJSON(),
        inlineTransform: cube.style.transform,
        computedTransform: getComputedStyle(cube).transform,
      },
      faces: faces.map(face => ({
        id: face.dataset.viewFace,
        rect: face.getBoundingClientRect().toJSON(),
        inlineTransform: face.style.transform,
        computedTransform: getComputedStyle(face).transform,
        background: getComputedStyle(face).backgroundColor,
        backfaceVisibility: getComputedStyle(face).backfaceVisibility,
      })),
    };
  });

  fs.writeFileSync(
    path.join(artifactsDir, 'view-cube-reference.json'),
    JSON.stringify(diagnostics, null, 2)
  );
  await wrap.screenshot({ path: path.join(artifactsDir, 'view-cube-reference.png') });
});
