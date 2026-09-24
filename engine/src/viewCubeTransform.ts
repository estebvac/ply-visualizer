import * as THREE from 'three';

const CAMERA_CSS_MULTIPLIERS = [
  1, -1, 1, 1,
  1, -1, 1, 1,
  1, -1, 1, 1,
  1, -1, 1, 1,
] as const;

function epsilon(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

/**
 * Convert the camera orientation to the CSS camera-matrix convention used by
 * Three.js CSS3DRenderer. Only rotation is included: the ViewCube is an
 * orientation gizmo, not a miniature camera/frustum.
 *
 * The camera quaternion maps camera-local coordinates to world coordinates.
 * The inverse therefore maps world axes into camera space. CSS3DRenderer then
 * flips the Y output row because CSS has Y-down screen coordinates.
 */
export function cameraQuaternionToCssMatrix3d(quaternion: THREE.Quaternion): string {
  const inverse = quaternion.clone().normalize().invert();
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(inverse);

  const values = matrix.elements.map((value, index) =>
    epsilon(value * CAMERA_CSS_MULTIPLIERS[index])
  );

  return `matrix3d(${values.join(',')})`;
}
