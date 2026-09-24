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
