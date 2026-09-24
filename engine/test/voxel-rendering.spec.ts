import { test, expect } from '@playwright/test';

const tinyColoredPly = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 0
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
0 0 1 255 255 0
`;

test('point cloud can switch Points -> Voxels -> Points and resize voxels', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#three-canvas');
  await page.waitForFunction(() => Boolean((window as any).visualizer));

  await page.click('[data-tab="files"]');
  await page.locator('#hiddenFileInput').setInputFiles({
    name: 'voxel-test.ply',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(tinyColoredPly),
  });

  await expect(page.locator('#file-list .file-item')).toHaveCount(1, { timeout: 15_000 });

  const voxelButton = page.locator('.render-mode-btn[data-mode="voxels"]').first();
  await expect(voxelButton).toBeVisible();
  await voxelButton.click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const v: any = (window as any).visualizer;
        return {
          voxelVisible: !!v.voxelsVisible?.[0],
          pointsVisible: !!v.pointsVisible?.[0],
          sourceVisible: !!v.meshes?.[0]?.visible,
          voxelObjectVisible: !!v.voxelObjects?.[0]?.visible,
          instanceCount: v.voxelObjects?.[0]?.count ?? 0,
          voxelSize: v.voxelObjects?.[0]?.userData?.voxelSize ?? 0,
          hasInstanceColor: !!v.voxelObjects?.[0]?.instanceColor,
        };
      })
    )
    .toEqual({
      voxelVisible: true,
      pointsVisible: false,
      sourceVisible: false,
      voxelObjectVisible: true,
      instanceCount: 4,
      voxelSize: 0.1,
      hasInstanceColor: true,
    });

  const voxelSize = page.locator('#voxel-size-0');
  await expect(voxelSize).toBeVisible();
  await voxelSize.fill('0.25');
  await voxelSize.blur();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const v: any = (window as any).visualizer;
        return {
          stored: v.voxelSizes?.[0],
          rendered: v.voxelObjects?.[0]?.userData?.voxelSize,
        };
      })
    )
    .toEqual({ stored: 0.25, rendered: 0.25 });

  const pointsButton = page.locator('.render-mode-btn[data-mode="points"]').first();
  await pointsButton.click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const v: any = (window as any).visualizer;
        return {
          voxelVisible: !!v.voxelsVisible?.[0],
          pointsVisible: !!v.pointsVisible?.[0],
          sourceVisible: !!v.meshes?.[0]?.visible,
          voxelObjectVisible: !!v.voxelObjects?.[0]?.visible,
        };
      })
    )
    .toEqual({
      voxelVisible: false,
      pointsVisible: true,
      sourceVisible: true,
      voxelObjectVisible: false,
    });
});
