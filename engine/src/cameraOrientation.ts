import * as THREE from 'three';

export const NAVIGATION_UP = new THREE.Vector3(0, 0, 1);

export function resetStandardOrbitUp(camera: THREE.PerspectiveCamera): void {
  camera.up.copy(NAVIGATION_UP);
}
