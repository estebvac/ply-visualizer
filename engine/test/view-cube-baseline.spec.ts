import { test, expect } from '@playwright/test';

test('verified Orbit/ViewCube baseline renders and snaps around the current target', async ({ page }) => {
  await page.goto('/3d-visualizer/');
  await page.waitForSelector('#three-canvas');
  await page.waitForFunction(() => Boolean((window as any).visualizer?.controls));

  await page.click('[data-tab="camera"]');

  const cube = page.locator('[data-view-cube]');
  await expect(cube).toBeVisible();
  await expect(page.locator('[data-view-face]')).toHaveCount(6);

  const before = await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      controlType: v.controlType,
      target: v.controls.target.toArray(),
      distance: v.camera.position.distanceTo(v.controls.target),
      up: v.camera.up.toArray(),
    };
  });

  expect(before.controlType).toBe('orbit');
  expect(before.up[0]).toBeCloseTo(0, 8);
  expect(before.up[1]).toBeCloseTo(0, 8);
  expect(before.up[2]).toBeCloseTo(1, 8);

  await page.locator('[data-view-kind="face"][data-view-direction="+X"]').first().click();
  await page.waitForFunction(() => !(window as any).visualizer.cameraViewAnimator.isAnimating);

  const after = await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    const offset = v.camera.position.clone().sub(v.controls.target).normalize();
    return {
      target: v.controls.target.toArray(),
      distance: v.camera.position.distanceTo(v.controls.target),
      direction: offset.toArray(),
      up: v.camera.up.toArray(),
    };
  });

  expect(after.target[0]).toBeCloseTo(before.target[0], 8);
  expect(after.target[1]).toBeCloseTo(before.target[1], 8);
  expect(after.target[2]).toBeCloseTo(before.target[2], 8);
  expect(after.distance).toBeCloseTo(before.distance, 6);
  expect(after.direction[0]).toBeGreaterThan(0.999999);
  expect(Math.abs(after.direction[1])).toBeLessThan(1e-6);
  expect(Math.abs(after.direction[2])).toBeLessThan(1e-5);
  expect(after.up[2]).toBeCloseTo(1, 8);

  const scene = page.locator('[data-view-cube-scene]');
  const geometry = await scene.evaluate(el => {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const style = getComputedStyle(el as HTMLElement);
    return { width: rect.width, height: rect.height, perspective: style.perspective };
  });
  expect(geometry.width).toBeCloseTo(136, 0);
  expect(geometry.height).toBeCloseTo(136, 0);
  expect(parseFloat(geometry.perspective)).toBeCloseTo(228, 0);
});
