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

  await page
    .locator('[data-view-kind="face"][data-view-direction="+X"]')
    .first()
    .evaluate((el: HTMLButtonElement) => el.click());
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => (window as any).visualizer.cameraViewAnimator.isAnimating)
  ).toBe(false);

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


test('standard LMB orbit keeps the current pivot and distance', async ({ page }) => {
  await page.goto('/3d-visualizer/');
  await page.waitForSelector('#three-canvas');
  await page.waitForFunction(() => Boolean((window as any).visualizer?.controls));

  const before = await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      position: v.camera.position.toArray(),
      target: v.controls.target.toArray(),
      distance: v.camera.position.distanceTo(v.controls.target),
    };
  });

  const canvas = page.locator('#three-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.55;
  const y = box!.y + box!.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 90, y - 35, { steps: 10 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      position: v.camera.position.toArray(),
      target: v.controls.target.toArray(),
      distance: v.camera.position.distanceTo(v.controls.target),
      up: v.camera.up.toArray(),
    };
  });

  expect(after.target[0]).toBeCloseTo(before.target[0], 7);
  expect(after.target[1]).toBeCloseTo(before.target[1], 7);
  expect(after.target[2]).toBeCloseTo(before.target[2], 7);
  expect(after.distance).toBeCloseTo(before.distance, 5);
  const moved = Math.hypot(
    after.position[0] - before.position[0],
    after.position[1] - before.position[1],
    after.position[2] - before.position[2]
  );
  expect(moved).toBeGreaterThan(0.01);
  expect(after.up[0]).toBeCloseTo(0, 8);
  expect(after.up[1]).toBeCloseTo(0, 8);
  expect(after.up[2]).toBeCloseTo(1, 8);
});
