import * as THREE from 'three';

export const NAVIGATION_UP = new THREE.Vector3(0, 0, 1);
const POLE_EPSILON = 1e-7;

export type CameraViewId =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z'
  | 'iso-positive'
  | 'iso-negative';

const CAMERA_VIEW_DIRECTIONS: Record<CameraViewId, THREE.Vector3> = {
  'positive-x': new THREE.Vector3(1, 0, 0),
  'negative-x': new THREE.Vector3(-1, 0, 0),
  'positive-y': new THREE.Vector3(0, 1, 0),
  'negative-y': new THREE.Vector3(0, -1, 0),
  'positive-z': new THREE.Vector3(0, 0, 1),
  'negative-z': new THREE.Vector3(0, 0, -1),
  'iso-positive': new THREE.Vector3(1, -1, 1).normalize(),
  'iso-negative': new THREE.Vector3(-1, 1, 1).normalize(),
};

export function resetStandardOrbitUp(camera: THREE.PerspectiveCamera): void {
  camera.up.copy(NAVIGATION_UP);
}

export function getViewDirection(id: CameraViewId): THREE.Vector3 {
  return CAMERA_VIEW_DIRECTIONS[id].clone().normalize();
}

export function poleSafeDirection(direction: THREE.Vector3): THREE.Vector3 {
  const d = direction.clone().normalize();
  if (Math.abs(Math.abs(d.z) - 1) < 1e-10) {
    d.x = POLE_EPSILON;
    d.normalize();
  }
  return d;
}
