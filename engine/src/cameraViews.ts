import * as THREE from 'three';
import type { CameraViewId } from './cameraOrientation';
import {
  getViewDirection,
  NAVIGATION_UP,
  poleSafeDirection,
} from './cameraOrientation';

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
  cameraViewAnimator?: { cancel(): void };
  controlType?: string;
}

function presetToViewId(preset: CameraPreset): CameraViewId {
  if (preset === 'isometric') return 'iso-positive';
  if (preset === 'isometric-opposite') return 'iso-negative';
  return preset;
}

function commitCameraChange(host: CameraViewHost): void {
  host.controls.update();
  host.updateCameraMatrix();
  host.updateCameraControlsPanel();
  host.requestRender();
}

export function applyDeterministicCameraView(host: CameraViewHost, id: CameraViewId): void {
  host.cameraViewAnimator?.cancel();
  const target = host.controls.target.clone();
  const distance = Math.max(host.camera.position.distanceTo(target), 1e-6);
  const direction = poleSafeDirection(getViewDirection(id));

  if (host.controlType === 'orbit') {
    host.camera.up.copy(NAVIGATION_UP);
  }
  host.camera.position.copy(target).addScaledVector(direction, distance);
  host.controls.target.copy(target);
  commitCameraChange(host);
}

export function applyCameraPreset(host: CameraViewHost, preset: CameraPreset): void {
  applyDeterministicCameraView(host, presetToViewId(preset));
}

export function setCameraPosition(host: CameraViewHost, x: number, y: number, z: number): boolean {
  host.cameraViewAnimator?.cancel();
  if (![x, y, z].every(Number.isFinite)) {
    return false;
  }

  const next = new THREE.Vector3(x, y, z);
  const target = host.controls.target;
  if (next.distanceToSquared(target) < 1e-12) {
    return false;
  }

  host.camera.position.copy(next);
  if (host.controlType === 'orbit') {
    host.camera.up.copy(NAVIGATION_UP);
  }
  host.camera.lookAt(target);
  commitCameraChange(host);
  return true;
}
