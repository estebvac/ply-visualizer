import { test, expect, Page } from '@playwright/test';
import path from 'path';

async function getNavigationState(page: Page) {
  return page.evaluate(() => {
    const v: any = (window as any).visualizer;
    return {
      controlType: v.controlType,
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

async function projectWorldPointToCanvas(
  page: Page,
  world: [number, number, number]
): Promise<{ clientX: number; clientY: number }> {
  return page.evaluate(([x, y, z]) => {
    const v: any = (window as any).visualizer;
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();

    v.camera.updateMatrixWorld(true);
    const view = v.camera.matrixWorldInverse.elements as number[];
    const projection = v.camera.projectionMatrix.elements as number[];

    const mul = (m: number[], p: number[]) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * p[3],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * p[3],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * p[3],
      m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * p[3],
    ];

    const cameraPoint = mul(view, [x, y, z, 1]);
    const clip = mul(projection, cameraPoint);
    const ndcX = clip[0] / clip[3];
    const ndcY = clip[1] / clip[3];

    return {
      clientX: rect.left + ((ndcX + 1) * 0.5) * rect.width,
      clientY: rect.top + ((1 - ndcY) * 0.5) * rect.height,
    };
  }, world);
}

async function loadSampleMesh(page: Page) {
  await page.click('[data-tab="files"]');
  const plyPath = path.resolve('../testfiles/open3d/sample_mesh.ply');
  await page.locator('#hiddenFileInput').setInputFiles(plyPath);
  const loading = page.locator('#loading');
  if (await loading.isVisible()) {
    await expect(loading).toBeHidden({ timeout: 60000 });
  }
  await page.waitForTimeout(500);
}

async function dragCanvas(
  page: Page,
  button: 'left' | 'middle' | 'right',
  dx: number,
  dy: number
) {
  const canvas = page.locator('#three-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.55;
  const y = box!.y + box!.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button });
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

  test('uses LMB orbit, MMB dolly, RMB pan, wheel dolly, and no inertia', async ({ page }) => {
    await loadSampleMesh(page);

    const before = await cameraState(page);

    await dragCanvas(page, 'left', 90, -45);
    const afterLeft = await cameraState(page);
    expect(delta3(afterLeft.position, before.position)).toBeGreaterThan(1e-4);
    expect(delta3(afterLeft.target, before.target)).toBeLessThan(1e-5);
    expect(Math.abs(afterLeft.distance - before.distance)).toBeLessThan(1e-4);

    await dragCanvas(page, 'middle', 0, 80);
    const afterMiddle = await cameraState(page);
    expect(Math.abs(afterMiddle.distance - afterLeft.distance)).toBeGreaterThan(1e-4);
    expect(delta3(afterMiddle.target, afterLeft.target)).toBeLessThan(1e-5);

    await dragCanvas(page, 'right', 70, 35);
    const afterRight = await cameraState(page);
    expect(delta3(afterRight.target, afterMiddle.target)).toBeGreaterThan(1e-4);
    expect(Math.abs(afterRight.distance - afterMiddle.distance)).toBeLessThan(1e-4);

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50);
    const afterWheel = await cameraState(page);
    expect(Math.abs(afterWheel.distance - afterRight.distance)).toBeGreaterThan(1e-4);

    const settled = await cameraState(page);
    await page.waitForTimeout(300);
    const later = await cameraState(page);
    expect(delta3(later.position, settled.position)).toBeLessThan(1e-6);
    expect(delta3(later.target, settled.target)).toBeLessThan(1e-6);

    const upLength = Math.hypot(...later.up);
    expect(upLength).toBeGreaterThan(0.999);
    expect(upLength).toBeLessThan(1.001);
    expect(delta3(later.up, before.up)).toBeLessThan(1e-6);
  });

  test('double-click sets pivot without moving camera and Shift + double-click measures', async ({
    page,
  }) => {
    const pivotPly = Buffer.from(
      [
        'ply',
        'format ascii 1.0',
        'element vertex 2',
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        '-1 0 0',
        '3 0 0',
        '',
      ].join('\n'),
      'utf8'
    );

    await page.click('[data-tab="files"]');
    await page.locator('#hiddenFileInput').setInputFiles({
      name: 'pivot_test.ply',
      mimeType: 'application/octet-stream',
      buffer: pivotPly,
    });
    const loading = page.locator('#loading');
    if (await loading.isVisible()) {
      await expect(loading).toBeHidden({ timeout: 60000 });
    }
    await page.waitForTimeout(500);

    const pick = await projectWorldPointToCanvas(page, [3, 0, 0]);

    const before = await cameraState(page);
    await page.evaluate(
      ({ clientX, clientY }) => {
        const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
        canvas.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX, clientY })
        );
      },
      pick
    );
    await page.waitForTimeout(100);

    const afterPivot = await cameraState(page);
    expect(delta3(afterPivot.position, before.position)).toBeLessThan(1e-6);
    expect(delta3(afterPivot.target, before.target)).toBeGreaterThan(1e-3);

    const beforeMeasure = await page.evaluate(() => {
      const v: any = (window as any).visualizer;
      return {
        target: v.controls.target.toArray(),
        count: v.measurementManager?.getMeasurements().length ?? 0,
      };
    });
    const measurePick = await projectWorldPointToCanvas(page, [3, 0, 0]);

    await page.evaluate(
      ({ clientX, clientY }) => {
        const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
        canvas.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            clientX,
            clientY,
            shiftKey: true,
          })
        );
      },
      measurePick
    );
    await page.waitForTimeout(100);

    const afterMeasure = await page.evaluate(() => {
      const v: any = (window as any).visualizer;
      return {
        target: v.controls.target.toArray(),
        count: v.measurementManager?.getMeasurements().length ?? 0,
      };
    });

    expect(afterMeasure.count).toBe(beforeMeasure.count + 1);
    expect(afterMeasure.target).toEqual(beforeMeasure.target);
  });


  test('legacy mode shortcuts do not replace Standard Orbit', async ({ page }) => {
    for (const key of ['t', 'i', 'k', 'o']) {
      await page.keyboard.press(key);
      expect(
        await page.evaluate(() => (window as any).visualizer.controlType)
      ).toBe('orbit');
    }
  });

  test('Fit and Reset shortcuts are ignored while a camera input has focus', async ({ page }) => {
    await loadSampleMesh(page);
    await page.click('[data-tab="camera"]');

    const input = page.locator('#fov-input');
    await input.focus();
    const before = await cameraState(page);

    await page.keyboard.press('F');
    await page.keyboard.press('R');

    const after = await cameraState(page);
    expect(delta3(after.position, before.position)).toBeLessThan(1e-6);
    expect(delta3(after.target, before.target)).toBeLessThan(1e-6);
  });

  test('suppresses the context menu only on the navigation canvas', async ({ page }) => {
    await loadSampleMesh(page);

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

    expect(await page.evaluate(() => (window as any).__canvasContextMenuPrevented)).toBe(true);
  });
});