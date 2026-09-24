import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Configure the viewer's normal navigation to match Three.js OrbitControls.
 *
 * Keep this deliberately small: Three.js owns the camera manipulation math.
 * The viewer only defines the interaction contract and distance limits.
 */
export function configureStandardOrbitControls(controls: OrbitControls): void {
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = false;
  controls.cursorStyle = 'grab';
  controls.maxPolarAngle = Math.PI / 2;
  controls.keyPanSpeed = 7;
  controls.keyRotateSpeed = 1;
  controls.minDistance = 0.001;
  controls.maxDistance = 50000;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  // Match the official Three.js OrbitControls example: plain arrows pan,
  // Shift/Ctrl/Meta + arrows rotate. dispose() removes this listener.
  controls.listenToKeyEvents(window as unknown as HTMLElement);
}