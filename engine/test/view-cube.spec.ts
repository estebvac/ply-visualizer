import { test, expect, Page } from '@playwright/test';
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

function delta3(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('Camera tab renders a six-face CSS 3D view cube', async ({ page }) => {
  await loadSampleMesh(page);
  await expect(page.locator('[data-view-cube]')).toBeVisible();
  for (const face of ['+x', '-x', '+y', '-y', '+z', '-z']) {
    await expect(page.locator(`[data-view-face="${face}"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-view-direction]')).toHaveCount(20);
});

test('animated view snap preserves target, distance, and +Z up', async ({ page }) => {
  await loadSampleMesh(page);
  const before = await cameraState(page);

  await page.getByRole('button', { name: 'View from +X' }).click();
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

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

  await page.getByRole('button', { name: 'View from -Y' }).click();
  await page.waitForFunction(() => (window as any).visualizer.cameraViewAnimator.isAnimating);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 30, y, { steps: 4 });
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

  const state = await cameraState(page);
  expect(state.position.every(Number.isFinite)).toBe(true);
});
