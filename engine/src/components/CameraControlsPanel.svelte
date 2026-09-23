<script lang="ts">
  import { viewerState } from '../state/viewer.svelte';
  import { captureScreenshot, copyCameraStateToClipboard } from '../utils/viewCapture';
  import { setCameraPosition } from '../cameraViews';
  import ViewOrientationSelector from './ViewOrientationSelector.svelte';

  let { host }: { host: any } = $props();

  type PositionAxis = 'x' | 'y' | 'z';

  const cameraDistance = $derived(
    Math.hypot(
      viewerState.cameraPositionX - viewerState.cameraTargetX,
      viewerState.cameraPositionY - viewerState.cameraTargetY,
      viewerState.cameraPositionZ - viewerState.cameraTargetZ
    )
  );
  const positionSliderSpan = $derived(Math.max(cameraDistance * 2, 1));
  const positionSliderStep = $derived(Math.max(positionSliderSpan / 1000, 0.001));
  const positionAxes = $derived([
    {
      key: 'x' as PositionAxis,
      label: 'X',
      value: viewerState.cameraPositionX,
      target: viewerState.cameraTargetX,
    },
    {
      key: 'y' as PositionAxis,
      label: 'Y',
      value: viewerState.cameraPositionY,
      target: viewerState.cameraTargetY,
    },
    {
      key: 'z' as PositionAxis,
      label: 'Z',
      value: viewerState.cameraPositionZ,
      target: viewerState.cameraTargetZ,
    },
  ]);

  function updatePositionAxis(axis: PositionAxis, value: number): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }
    const next = {
      x: viewerState.cameraPositionX,
      y: viewerState.cameraPositionY,
      z: viewerState.cameraPositionZ,
    };
    next[axis] = value;
    return setCameraPosition(host, next.x, next.y, next.z);
  }

  function onPositionSliderInput(axis: PositionAxis, e: Event) {
    updatePositionAxis(axis, parseFloat((e.target as HTMLInputElement).value));
  }

  function onPositionInputCommit(axis: PositionAxis, e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);
    if (!updatePositionAxis(axis, value)) {
      const current =
        axis === 'x'
          ? viewerState.cameraPositionX
          : axis === 'y'
            ? viewerState.cameraPositionY
            : viewerState.cameraPositionZ;
      input.value = current.toFixed(3);
    }
  }

  function onPositionInputKeydown(axis: PositionAxis, e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onPositionInputCommit(axis, e);
      (e.target as HTMLInputElement).blur();
    }
  }

  function onFovSliderInput(e: Event) {
    const newFov = parseFloat((e.target as HTMLInputElement).value);
    host.camera.fov = newFov;
    host.camera.updateProjectionMatrix();
    viewerState.cameraFov = newFov;
    host.requestRender();
  }

  function onFovInputCommit(e: Event) {
    const input = e.target as HTMLInputElement;
    const newFov = parseFloat(input.value);
    if (!isNaN(newFov) && newFov > 0) {
      host.camera.fov = newFov;
      host.camera.updateProjectionMatrix();
      viewerState.cameraFov = newFov;
      host.requestRender();
    } else {
      input.value = host.camera.fov.toFixed(2);
    }
  }

  function onFovInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onFovInputCommit(e);
      (e.target as HTMLInputElement).blur();
    }
  }

  function onFovInputFocus(e: Event) {
    (e.target as HTMLInputElement).select();
  }

  function onClipPlaneCommit(which: 'near' | 'far', e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);
    const valid =
      !isNaN(value) &&
      value > 0 &&
      (which === 'near' ? value < host.camera.far : value > host.camera.near);
    if (valid) {
      host.camera[which] = value;
      host.camera.updateProjectionMatrix();
      if (which === 'near') {
        viewerState.cameraNear = value;
      } else {
        viewerState.cameraFar = value;
      }
      host.requestRender();
    } else {
      input.value = String(host.camera[which]);
    }
  }

  function onClipPlaneKeydown(which: 'near' | 'far', e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onClipPlaneCommit(which, e);
      (e.target as HTMLInputElement).blur();
    }
  }

  function onScreenshot() {
    captureScreenshot(host);
  }

  function onCopyCameraState() {
    copyCameraStateToClipboard(host);
  }

  function onResetCamera() {
    host.resetCameraToDefault();
  }
  function onModifyPosition() {
    host.showCameraPositionDialog();
  }
  function onModifyRotation() {
    host.showCameraRotationDialog();
  }
  function onModifyRotationCenter() {
    host.showRotationCenterDialog();
  }
</script>

<div class="camera-controls-section">
  <span style="font-size:10px;font-weight:bold;">View Orientation:</span>
  <ViewOrientationSelector {host} />
</div>

<div class="camera-controls-section">
  <label for="camera-fov" style="font-size:10px;">Field of View:</label><br />
  <input
    type="range"
    id="camera-fov"
    min="10"
    max="150"
    step="1"
    value={viewerState.cameraFov}
    style="width:100%;margin:2px 0;"
    oninput={onFovSliderInput}
  />
  <input
    type="text"
    id="fov-input"
    value={viewerState.cameraFov.toFixed(2)}
    style="font-size: 10px; width: 30px; border: none; background: transparent; color: var(--vscode-foreground); text-align: left; padding: 0; margin: 0; outline: none; cursor: text;"
    onblur={onFovInputCommit}
    onkeydown={onFovInputKeydown}
    onfocus={onFovInputFocus}
  /><span style="font-size:10px;">°</span>
</div>

<div class="camera-controls-section">
  <span style="font-size:10px;font-weight:bold;">Camera XYZ Position:</span>
  <div class="position-description">
    Moving an axis keeps the current rotation center and recalculates the camera direction.
  </div>
  {#each positionAxes as axis (axis.key)}
    <div class="position-axis-row">
      <label for={`camera-position-${axis.key}`} class="axis-label">{axis.label}</label>
      <input
        type="range"
        id={`camera-position-${axis.key}`}
        min={axis.target - positionSliderSpan}
        max={axis.target + positionSliderSpan}
        step={positionSliderStep}
        value={axis.value}
        class="position-slider"
        oninput={e => onPositionSliderInput(axis.key, e)}
      />
      <input
        type="number"
        value={axis.value.toFixed(3)}
        step={positionSliderStep}
        class="position-value"
        aria-label={`Camera ${axis.label} position`}
        onblur={e => onPositionInputCommit(axis.key, e)}
        onkeydown={e => onPositionInputKeydown(axis.key, e)}
        onfocus={onFovInputFocus}
      />
    </div>
  {/each}
  <div class="position-range-note">
    Slider range follows the current target and camera distance. Numeric fields accept coordinates outside that range.
  </div>
</div>

<div class="camera-controls-section">
  <span style="font-size:10px;font-weight:bold;">Camera Position &amp; Rotation:</span>
  <div class="matrix-display">
    <div style="font-size:10px;margin:4px 0;">
      <div><strong>Position:</strong> {viewerState.cameraPositionText}</div>
      <div><strong>Rotation:</strong> {viewerState.cameraRotationText}</div>
      <div><strong>Rotation Center:</strong> {viewerState.cameraTargetText}</div>
    </div>
  </div>
  <div style="display:flex;gap:4px;margin-top:4px;">
    <button
      id="modify-camera-position"
      class="control-button"
      style="flex:1;font-size:9px;"
      onclick={onModifyPosition}>Modify Position</button
    >
  </div>
  <div style="display:flex;gap:4px;margin-top:4px;">
    <button
      id="modify-camera-rotation"
      class="control-button"
      style="flex:1;font-size:9px;"
      onclick={onModifyRotation}>Modify Rotation</button
    >
  </div>
  <div style="display:flex;gap:4px;margin-top:4px;">
    <button
      id="modify-rotation-center"
      class="control-button"
      style="flex:1;font-size:9px;"
      onclick={onModifyRotationCenter}>Modify Rotation Center</button
    >
  </div>
  <button id="reset-camera-matrix" class="control-button" style="margin-top:12px;" onclick={onResetCamera}
    >Reset Camera</button
  >
</div>

<style>
  .position-description,
  .position-range-note {
    color: var(--vscode-descriptionForeground);
    font-size: 9px;
    line-height: 1.3;
    margin: 4px 0 6px;
  }

  .position-range-note {
    margin: 5px 0 0;
  }

  .position-axis-row {
    display: grid;
    grid-template-columns: 13px minmax(70px, 1fr) 68px;
    gap: 5px;
    align-items: center;
    margin-top: 4px;
  }

  .axis-label {
    font-size: 10px;
    font-weight: bold;
  }

  .position-slider {
    width: 100%;
    min-width: 0;
    margin: 0;
  }

  .position-value {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    font-size: 9px;
  }
</style>

<div class="camera-controls-section">
  <span style="font-size:10px;font-weight:bold;">Clip Planes (near / far):</span>
  <div style="display:flex;gap:4px;margin-top:2px;align-items:center;">
    <input
      type="text"
      id="camera-near-input"
      value={String(viewerState.cameraNear)}
      style="font-size:10px;flex:1;min-width:0;"
      onblur={e => onClipPlaneCommit('near', e)}
      onkeydown={e => onClipPlaneKeydown('near', e)}
      onfocus={onFovInputFocus}
    />
    <input
      type="text"
      id="camera-far-input"
      value={String(viewerState.cameraFar)}
      style="font-size:10px;flex:1;min-width:0;"
      onblur={e => onClipPlaneCommit('far', e)}
      onkeydown={e => onClipPlaneKeydown('far', e)}
      onfocus={onFovInputFocus}
    />
  </div>
  <div style="display:flex;gap:4px;margin-top:8px;">
    <!-- margin-bottom:0 overrides .camera-controls-section .control-button's
         4px stacking margin, which otherwise makes the non-last-child button
         4px shorter than its stretch-aligned sibling in this row. -->
    <button
      id="save-screenshot"
      class="control-button"
      style="flex:1;min-width:0;margin-bottom:0;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      onclick={onScreenshot}>Save Screenshot</button
    >
    <button
      id="copy-camera-state"
      class="control-button"
      style="flex:1;min-width:0;margin-bottom:0;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      onclick={onCopyCameraState}>Copy Camera JSON</button
    >
  </div>
</div>
