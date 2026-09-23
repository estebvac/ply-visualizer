import * as THREE from 'three';

export type CameraPreset =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z'
  | 'isometric'
  | 'isometric-opposite';

export interface CameraViewHost {
  camera: THREE.PerspectiveCamera;
  controls: {
    target: THREE.Vector3;
    update(): void;
  };
  requestRender(): void;
  updateCameraMatrix(): void;
  updateCameraControlsPanel(): void;
}

const PRESET_DIRECTIONS: Record<CameraPreset, THREE.Vector3> = {
  'positive-x': new THREE.Vector3(1, 0, 0),
  'negative-x': new THREE.Vector3(-1, 0, 0),
  'positive-y': new THREE.Vector3(0, 1, 0),
  'negative-y': new THREE.Vector3(0, -1, 0),
  'positive-z': new THREE.Vector3(0, 0, 1),
  'negative-z': new THREE.Vector3(0, 0, -1),
  isometric: new THREE.Vector3(1, -1, 1).normalize(),
  'isometric-opposite': new THREE.Vector3(-1, 1, 1).normalize(),
};

function stableUpVector(direction: THREE.Vector3, preferredUp: THREE.Vector3): THREE.Vector3 {
  const projected = preferredUp.clone().projectOnPlane(direction);
  if (projected.lengthSq() > 1e-8) {
    return projected.normalize();
  }

  for (const fallback of [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ]) {
    fallback.projectOnPlane(direction);
    if (fallback.lengthSq() > 1e-8) {
      return fallback.normalize();
    }
  }
  return new THREE.Vector3(0, 1, 0);
}

function commitCameraChange(host: CameraViewHost): void {
  host.controls.update();
  host.updateCameraMatrix();
  host.updateCameraControlsPanel();
  host.requestRender();
}

export function applyCameraPreset(host: CameraViewHost, preset: CameraPreset): void {
  const target = host.controls.target.clone();
  const distance = Math.max(host.camera.position.distanceTo(target), 1e-6);
  const direction = PRESET_DIRECTIONS[preset].clone().normalize();

  host.camera.up.copy(stableUpVector(direction, host.camera.up));
  host.camera.position.copy(target).addScaledVector(direction, distance);
  host.camera.lookAt(target);
  commitCameraChange(host);
}

export function setCameraPosition(host: CameraViewHost, x: number, y: number, z: number): boolean {
  if (![x, y, z].every(Number.isFinite)) {
    return false;
  }

  const next = new THREE.Vector3(x, y, z);
  const target = host.controls.target;
  if (next.distanceToSquared(target) < 1e-12) {
    return false;
  }

  host.camera.position.copy(next);
  host.camera.lookAt(target);
  commitCameraChange(host);
  return true;
}
