import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { cameraQuaternionToCssMatrix3d } from '../src/viewCubeTransform';

function matrixValues(css: string): number[] {
  expect(css.startsWith('matrix3d(')).toBe(true);
  return css
    .slice('matrix3d('.length, -1)
    .split(',')
    .map(Number);
}

function transformDirection(values: number[], v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    values[0] * v.x + values[4] * v.y + values[8] * v.z,
    values[1] * v.x + values[5] * v.y + values[9] * v.z,
    values[2] * v.x + values[6] * v.y + values[10] * v.z
  );
}

test('ViewCube identity orientation remains a rigid identity CSS rotation', () => {
  const values = matrixValues(cameraQuaternionToCssMatrix3d(new THREE.Quaternion()));

  expect(values).toHaveLength(16);
  expect(values[0]).toBeCloseTo(1, 10);
  expect(values[5]).toBeCloseTo(1, 10);
  expect(values[10]).toBeCloseTo(1, 10);
  expect(values[15]).toBeCloseTo(1, 10);
  expect(values.every(Number.isFinite)).toBe(true);
});

test('+Z world-up projects upward for a camera looking from +Y', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const values = matrixValues(cameraQuaternionToCssMatrix3d(camera.quaternion));

  // World +Z has the same numeric representation in CSS basis.
  const screenUp = transformDirection(values, new THREE.Vector3(0, 0, 1));
  // World +Y is represented as CSS -Y before the input basis conversion.
  const towardViewer = transformDirection(values, new THREE.Vector3(0, -1, 0));

  expect(screenUp.x).toBeCloseTo(0, 8);
  expect(screenUp.y).toBeLessThan(-0.999999);
  expect(Math.abs(screenUp.z)).toBeLessThan(1e-6);
  expect(towardViewer.z).toBeGreaterThan(0.999999);
});
