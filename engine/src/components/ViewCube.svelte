<script lang="ts">
  import * as THREE from 'three';
  import { viewerState } from '../state/viewer.svelte';
  import type { CameraViewId } from '../cameraOrientation';
  import { getViewDirection } from '../cameraOrientation';
  import { cameraQuaternionToCssMatrix3d } from '../viewCubeTransform';

  let { host }: { host: any } = $props();

  const CUBE_SIZE = 76;
  const CUBE_HALF = CUBE_SIZE / 2;
  const SCENE_SIZE = 136;
  const PERSPECTIVE = CUBE_SIZE * 3;

  type CubeChoice = {
    id: string;
    label: string;
    direction: THREE.Vector3;
    viewId?: CameraViewId;
    kind: 'face' | 'edge' | 'corner';
  };

  const faces: CubeChoice[] = [
    { id: '+x', label: '+X', viewId: 'positive-x', direction: new THREE.Vector3(1, 0, 0), kind: 'face' },
    { id: '-x', label: '−X', viewId: 'negative-x', direction: new THREE.Vector3(-1, 0, 0), kind: 'face' },
    { id: '+y', label: '+Y', viewId: 'positive-y', direction: new THREE.Vector3(0, 1, 0), kind: 'face' },
    { id: '-y', label: '−Y', viewId: 'negative-y', direction: new THREE.Vector3(0, -1, 0), kind: 'face' },
    { id: '+z', label: '+Z', viewId: 'positive-z', direction: new THREE.Vector3(0, 0, 1), kind: 'face' },
    { id: '-z', label: '−Z', viewId: 'negative-z', direction: new THREE.Vector3(0, 0, -1), kind: 'face' },
  ];

  const edges: CubeChoice[] = [];
  for (const [a, b] of [
    ['x', 'y'],
    ['x', 'z'],
    ['y', 'z'],
  ] as const) {
    for (const sa of [-1, 1] as const) {
      for (const sb of [-1, 1] as const) {
        const direction = new THREE.Vector3();
        direction[a] = sa;
        direction[b] = sb;
        direction.normalize();
        edges.push({
          id: `${sa > 0 ? '+' : '-'}${a.toUpperCase()} ${sb > 0 ? '+' : '-'}${b.toUpperCase()}`,
          label: '',
          direction,
          kind: 'edge',
        });
      }
    }
  }

  const corners: CubeChoice[] = [];
  for (const x of [-1, 1] as const) {
    for (const y of [-1, 1] as const) {
      for (const z of [-1, 1] as const) {
        corners.push({
          id: `${x > 0 ? '+' : '-'}X ${y > 0 ? '+' : '-'}Y ${z > 0 ? '+' : '-'}Z`,
          label: '',
          direction: new THREE.Vector3(x, y, z).normalize(),
          kind: 'corner',
        });
      }
    }
  }

  const choices = [...faces, ...edges, ...corners];
  let hoveredId = $state('');

  const cubeTransform = $derived.by(() => {
    // These state reads make the CSS gizmo follow every camera update without
    // introducing a second render loop.
    viewerState.cameraRotationText;
    viewerState.cameraPositionX;
    viewerState.cameraPositionY;
    viewerState.cameraPositionZ;
    viewerState.cameraTargetX;
    viewerState.cameraTargetY;
    viewerState.cameraTargetZ;

    return `translateZ(-${CUBE_HALF}px) ${cameraQuaternionToCssMatrix3d(host.camera.quaternion)}`;
  });

  const activeId = $derived.by(() => {
    viewerState.cameraPositionX;
    viewerState.cameraPositionY;
    viewerState.cameraPositionZ;
    viewerState.cameraTargetX;
    viewerState.cameraTargetY;
    viewerState.cameraTargetZ;

    const direction = new THREE.Vector3(
      viewerState.cameraPositionX - viewerState.cameraTargetX,
      viewerState.cameraPositionY - viewerState.cameraTargetY,
      viewerState.cameraPositionZ - viewerState.cameraTargetZ
    );
    if (direction.lengthSq() < 1e-12) return '';
    direction.normalize();

    let best = '';
    let bestDot = -Infinity;
    for (const choice of choices) {
      const dot = direction.dot(choice.direction);
      if (dot > bestDot) {
        bestDot = dot;
        best = choice.id;
      }
    }
    return bestDot >= 0.92 ? best : '';
  });

  function faceToken(faceId: string): string {
    return `${faceId[0]}${faceId[1].toUpperCase()}`;
  }

  function isFaceHighlighted(faceId: string): boolean {
    const selected = hoveredId || activeId;
    if (!selected) return false;
    if (selected === faceId) return true;
    return selected.split(' ').includes(faceToken(faceId));
  }

  function snap(choice: CubeChoice) {
    const direction = choice.viewId ? getViewDirection(choice.viewId) : choice.direction.clone();
    host.cameraViewAnimator.animateToDirection(host, direction);
  }

  function exactHotspotPosition(choice: CubeChoice): THREE.Vector3 {
    const nonZeroComponents = [choice.direction.x, choice.direction.y, choice.direction.z].filter(
      value => Math.abs(value) > 1e-9
    ).length;
    const scale = CUBE_HALF * Math.sqrt(nonZeroComponents);
    return choice.direction.clone().multiplyScalar(scale);
  }

  function hotspotTransform(choice: CubeChoice): string {
    const p = exactHotspotPosition(choice);
    return `translate3d(${p.x}px, ${p.y}px, ${p.z}px) translate(-50%, -50%)`;
  }

  function accessibleLabel(choice: CubeChoice): string {
    if (choice.kind === 'face') return `View from ${choice.label}`;
    return `View from ${choice.id} ${choice.kind}`;
  }

  function stopAndSnap(event: MouseEvent, choice: CubeChoice) {
    event.stopPropagation();
    snap(choice);
  }
</script>

<div class="view-cube-wrap" data-view-cube-wrap>
  <div
    class="view-cube-scene"
    aria-label="Camera view cube"
    data-view-cube-scene
  >
    <div class="view-cube" style:transform={cubeTransform} data-view-cube>
      {#each faces as face (face.id)}
        <button
          class="cube-face"
          class:highlighted={isFaceHighlighted(face.id)}
          class:active={activeId === face.id}
          class:face-pos-x={face.id === '+x'}
          class:face-neg-x={face.id === '-x'}
          class:face-pos-y={face.id === '+y'}
          class:face-neg-y={face.id === '-y'}
          class:face-pos-z={face.id === '+z'}
          class:face-neg-z={face.id === '-z'}
          data-view-face={face.id}
          aria-label={accessibleLabel(face)}
          title={accessibleLabel(face)}
          onmouseenter={() => (hoveredId = face.id)}
          onmouseleave={() => (hoveredId = '')}
          onclick={event => stopAndSnap(event, face)}
        >
          <span class="face-label">{face.label}</span>
        </button>
      {/each}

      {#each edges as edge (edge.id)}
        <button
          class="cube-hit-region edge-hit-region"
          style:transform={hotspotTransform(edge)}
          data-view-edge={edge.id}
          data-view-direction={edge.id}
          aria-label={accessibleLabel(edge)}
          title={accessibleLabel(edge)}
          onmouseenter={() => (hoveredId = edge.id)}
          onmouseleave={() => (hoveredId = '')}
          onclick={event => stopAndSnap(event, edge)}
        ></button>
      {/each}

      {#each corners as corner (corner.id)}
        <button
          class="cube-hit-region corner-hit-region"
          style:transform={hotspotTransform(corner)}
          data-view-corner={corner.id}
          data-view-direction={corner.id}
          aria-label={accessibleLabel(corner)}
          title={accessibleLabel(corner)}
          onmouseenter={() => (hoveredId = corner.id)}
          onmouseleave={() => (hoveredId = '')}
          onclick={event => stopAndSnap(event, corner)}
        ></button>
      {/each}
    </div>
  </div>

  <div class="view-hint">
    Drag the scene to orbit. Click a face, edge, or corner to align the camera around the current rotation center.
  </div>
</div>

<style>
  .view-cube-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    margin: 8px auto 4px;
    width: 100%;
    min-width: 0;
    text-align: center;
  }

  .view-cube-scene {
    position: relative;
    width: 136px;
    min-width: 136px;
    max-width: 136px;
    height: 136px;
    min-height: 136px;
    max-height: 136px;
    flex: 0 0 136px;
    perspective: 228px;
    perspective-origin: 50% 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    margin: 0 auto 8px;
  }

  .view-cube {
    position: relative;
    width: 76px;
    height: 76px;
    transform-style: preserve-3d;
    transform-origin: 50% 50%;
    transition: transform 70ms linear;
    will-change: transform;
  }

  .cube-face {
    all: unset;
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    width: 76px;
    height: 76px;
    display: grid;
    place-items: center;
    transform-style: preserve-3d;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground, #cccccc) 62%, transparent);
    background: color-mix(
      in srgb,
      var(--vscode-sideBar-background, #252526) 72%,
      var(--vscode-foreground, #cccccc) 28%
    );
    color: var(--vscode-foreground, #cccccc);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, white 5%, transparent);
  }

  .cube-face:hover,
  .cube-face:focus-visible,
  .cube-face.highlighted {
    background: color-mix(
      in srgb,
      var(--vscode-button-background, #0e639c) 42%,
      var(--vscode-sideBar-background, #252526) 58%
    );
    border-color: var(--vscode-focusBorder, #007fd4);
    outline: none;
  }

  .cube-face.active {
    background: color-mix(
      in srgb,
      var(--vscode-button-background, #0e639c) 58%,
      var(--vscode-sideBar-background, #252526) 42%
    );
  }

  /*
   * DeSandro cube geometry, scaled from 200 px to 76 px.
   * Axis labels are mapped onto the six physical planes; the geometry itself
   * remains the canonical six-plane cube.
   */
  .face-pos-z { transform: rotateY(0deg) translateZ(38px); }
  .face-pos-x { transform: rotateY(90deg) translateZ(38px); }
  .face-neg-z { transform: rotateY(180deg) translateZ(38px); }
  .face-neg-x { transform: rotateY(-90deg) translateZ(38px); }
  .face-neg-y { transform: rotateX(90deg) translateZ(38px); }
  .face-pos-y { transform: rotateX(-90deg) translateZ(38px); }

  .face-label {
    pointer-events: none;
    text-shadow: 0 1px 1px color-mix(in srgb, black 45%, transparent);
  }

  /*
   * Edge/corner hit regions are interaction-only. Their centers are placed on
   * the actual cube edge/corner (not on the inscribed direction sphere), and
   * they never render visible 3D geometry. Hover feedback is applied to the
   * participating cube faces above.
   */
  .cube-hit-region {
    all: unset;
    box-sizing: border-box;
    position: absolute;
    left: 50%;
    top: 50%;
    display: block;
    border: 0;
    background: transparent;
    outline: 0;
    opacity: 0;
    cursor: pointer;
    transform-style: preserve-3d;
  }

  .edge-hit-region {
    width: 18px;
    height: 18px;
  }

  .corner-hit-region {
    width: 20px;
    height: 20px;
  }

  .cube-hit-region:focus-visible {
    opacity: 0;
    outline: 0;
  }

  .view-hint {
    color: var(--vscode-descriptionForeground, #a0a0a0);
    font-size: 9px;
    line-height: 1.35;
    max-width: 190px;
    margin: 0 auto;
    pointer-events: none;
  }
</style>
