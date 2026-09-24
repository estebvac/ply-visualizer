import * as THREE from 'three';

function epsilon(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

/**
 * Convert the Three.js camera orientation into a rigid CSS-space rotation for
 * the DOM ViewCube.
 *
 * Three.js camera/world coordinates use +Y up while CSS 3D uses +Y down.
 * CSS3DRenderer handles this with a Y basis change on both sides of the camera
 * rotation: object CSS conversion supplies one basis flip and the camera CSS
 * matrix supplies the other. Because the ViewCube is native CSS geometry (not
 * a CSS3DObject), we perform both here:
 *
 *     M_css = S * R_camera^-1 * S,   S = diag(1, -1, 1)
 *
 * This conjugation has determinant +1, so the cube stays a rigid six-plane
 * object instead of entering a reflected CSS coordinate system.
 */
export function cameraQuaternionToCssMatrix3d(quaternion: THREE.Quaternion): string {
  const inverseRotation = new THREE.Matrix4().makeRotationFromQuaternion(
    quaternion.clone().normalize().invert()
  );
  const cssBasis = new THREE.Matrix4().makeScale(1, -1, 1);

  inverseRotation.premultiply(cssBasis).multiply(cssBasis);

  const values = inverseRotation.elements.map(epsilon);
  return `matrix3d(${values.join(',')})`;
}
