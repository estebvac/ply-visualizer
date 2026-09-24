import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Configure the viewer's normal navigation to match Three.js OrbitControls.
 *
 * Keep this deliberately small: Three.js owns the camera manipulation math.
 * The viewer only defines the interaction contract and distance limits.
 */
export function configureStandardOrbitControls(controls: OrbitControls): void {
  controls.enableDamping = false;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = false;
  controls.minDistance = 0.001;
  controls.maxDistance = 50000;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
}
