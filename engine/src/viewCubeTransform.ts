import * as THREE from 'three';

const CSS_Y_BASIS = new THREE.Matrix4().makeScale(1, -1, 1);

function epsilon(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

/**
 * Convert the Three.js camera orientation into a proper CSS 3D rotation.
 *
 * CSS3DRenderer flips Y when moving between Three.js and CSS coordinates. Its
 * camera matrix is only one half of that renderer's camera/object conversion,
 * so applying getCameraCSSMatrix() directly to a hand-built CSS cube introduces
 * a reflection (determinant -1) and collapses the six-plane cube visually.
 *
 * Our cube already lives directly in CSS coordinates. Convert both the source
 * and destination bases instead:
 *
 *   cssRotation = F * inverse(cameraRotation) * F
 *
 * where F = diag(1, -1, 1). The two reflections cancel, leaving a proper
 * determinant +1 rotation that preserves the DeSandro cube geometry.
 */
export function cameraQuaternionToCssMatrix3d(quaternion: THREE.Quaternion): string {
  const inverseRotation = new THREE.Matrix4().makeRotationFromQuaternion(
    quaternion.clone().normalize().invert()
  );

  const cssRotation = CSS_Y_BASIS.clone().multiply(inverseRotation).multiply(CSS_Y_BASIS);
  const values = cssRotation.elements.map(epsilon);

  return `matrix3d(${values.join(',')})`;
}
