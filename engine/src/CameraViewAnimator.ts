import * as THREE from 'three';
import { NAVIGATION_UP, poleSafeDirection } from './cameraOrientation';

export interface CameraViewAnimationHost {
  camera: THREE.PerspectiveCamera;
  controls: {
    target: THREE.Vector3;
    update(): void;
  };
  requestRender(): void;
}

export class CameraViewAnimator {
  private rafId: number | null = null;
  private generation = 0;
  private animating = false;

  get isAnimating(): boolean {
    return this.animating;
  }

  cancel(): void {
    this.generation++;
    this.animating = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  animateToDirection(
    host: CameraViewAnimationHost,
    direction: THREE.Vector3,
    durationMs = 220
  ): void {
    this.cancel();

    const target = host.controls.target.clone();
    const startOffset = host.camera.position.clone().sub(target);
    const distance = Math.max(startOffset.length(), 1e-6);
    const from = startOffset.normalize();
    const to = poleSafeDirection(direction);

    const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
    const identity = new THREE.Quaternion();
    const token = ++this.generation;
    const startTime = performance.now();
    this.animating = true;

    const frame = (now: number) => {
      if (token !== this.generation) {
        return;
      }

      const linearT = durationMs <= 0 ? 1 : Math.min((now - startTime) / durationMs, 1);
      const eased = linearT * linearT * (3 - 2 * linearT);
      const partial = identity.clone().slerp(rotation, eased);
      const currentDirection = from.clone().applyQuaternion(partial).normalize();

      host.camera.position.copy(target).addScaledVector(currentDirection, distance);
      host.camera.up.copy(NAVIGATION_UP);
      host.controls.target.copy(target);
      host.controls.update();
      host.requestRender();

      if (linearT < 1) {
        this.rafId = requestAnimationFrame(frame);
        return;
      }

      host.camera.position.copy(target).addScaledVector(to, distance);
      host.camera.up.copy(NAVIGATION_UP);
      host.controls.target.copy(target);
      host.controls.update();
      host.requestRender();
      this.rafId = null;
      this.animating = false;
    };

    this.rafId = requestAnimationFrame(frame);
  }
}
