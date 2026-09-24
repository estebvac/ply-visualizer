<script lang="ts">
  import * as THREE from 'three';
  import { viewerState } from '../state/viewer.svelte';
  import type { CameraViewId } from '../cameraOrientation';
  import { getViewDirection } from '../cameraOrientation';

  let { host }: { host: any } = $props();

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
        const d = new THREE.Vector3();
        d[a] = sa;
        d[b] = sb;
        d.normalize();
        edges.push({
          id: `${sa > 0 ? '+' : '-'}${a.toUpperCase()} ${sb > 0 ? '+' : '-'}${b.toUpperCase()}`,
          label: '',
          direction: d,
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

  const cubeTransform = $derived.by(() => {
    viewerState.cameraRotationText;
    viewerState.cameraPositionX;
    viewerState.cameraTargetX;
    const q = host.camera.quaternion.clone().invert();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    return `matrix3d(${m.elements.map((n: number) => Number(n.toFixed(8))).join(',')})`;
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

  function snap(choice: CubeChoice) {
    const direction = choice.viewId ? getViewDirection(choice.viewId) : choice.direction.clone();
    host.cameraViewAnimator.animateToDirection(host, direction);
  }

  function hotspotTransform(direction: THREE.Vector3): string {
    const extent = 34;
    return `translate3d(${direction.x * extent}px, ${-direction.y * extent}px, ${direction.z * extent}px) translate(-50%, -50%)`;
  }

  function accessibleLabel(choice: CubeChoice): string {
    if (choice.kind === 'face') return `View from ${choice.label}`;
    return `View from ${choice.id} ${choice.kind}`;
  }
</script>

<div class="view-cube-wrap">
  <div class="view-cube-scene" aria-label="Camera view cube">
    <div class="view-cube" style:transform={cubeTransform} data-view-cube>
      {#each faces as face (face.id)}
        <button
          class:active={activeId === face.id}
          class="cube-face"
          class:face-pos-x={face.id === '+x'}
          class:face-neg-x={face.id === '-x'}
          class:face-pos-y={face.id === '+y'}
          class:face-neg-y={face.id === '-y'}
          class:face-pos-z={face.id === '+z'}
          class:face-neg-z={face.id === '-z'}
          data-view-face={face.id}
          aria-label={accessibleLabel(face)}
          title={accessibleLabel(face)}
          onclick={() => snap(face)}
        >{face.label}</button>
      {/each}

      {#each edges as edge (edge.id)}
        <button
          class:active={activeId === edge.id}
          class="cube-hotspot edge-hotspot"
          style:transform={hotspotTransform(edge.direction)}
          data-view-direction={edge.id}
          aria-label={accessibleLabel(edge)}
          title={accessibleLabel(edge)}
          onclick={() => snap(edge)}
        ></button>
      {/each}

      {#each corners as corner (corner.id)}
        <button
          class:active={activeId === corner.id}
          class="cube-hotspot corner-hotspot"
          style:transform={hotspotTransform(corner.direction)}
          data-view-direction={corner.id}
          aria-label={accessibleLabel(corner)}
          title={accessibleLabel(corner)}
          onclick={() => snap(corner)}
        ></button>
      {/each}
    </div>
  </div>
  <div class="view-hint">Drag the scene to orbit. Click a face, edge, or corner to align the camera around the current rotation center.</div>
</div>

<style>
  .view-cube-wrap {
    margin: 6px auto 2px;
    text-align: center;
  }

  .view-cube-scene {
    width: 150px;
    height: 132px;
    margin: 0 auto;
    perspective: 330px;
    display: grid;
    place-items: center;
    overflow: visible;
  }

  .view-cube {
    position: relative;
    width: 68px;
    height: 68px;
    transform-style: preserve-3d;
    transition: transform 80ms linear;
  }

  .cube-face {
    position: absolute;
    inset: 0;
    width: 68px;
    height: 68px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
    background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 84%, transparent);
    color: var(--vscode-button-secondaryForeground);
    font-size: 12px;
    font-weight: 700;
    display: grid;
    place-items: center;
    backface-visibility: visible;
    cursor: pointer;
    opacity: 0.86;
  }

  .cube-face:hover,
  .cube-face:focus-visible,
  .cube-face.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    opacity: 1;
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }

  .face-pos-z { transform: translateZ(34px); }
  .face-neg-z { transform: rotateY(180deg) translateZ(34px); }
  .face-pos-x { transform: rotateY(90deg) translateZ(34px); }
  .face-neg-x { transform: rotateY(-90deg) translateZ(34px); }
  .face-pos-y { transform: rotateX(-90deg) translateZ(34px); }
  .face-neg-y { transform: rotateX(90deg) translateZ(34px); }

  .cube-hotspot {
    position: absolute;
    left: 50%;
    top: 50%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    z-index: 6;
  }

  .edge-hotspot {
    width: 18px;
    height: 18px;
  }

  .corner-hotspot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }

  .cube-hotspot:hover,
  .cube-hotspot:focus-visible,
  .cube-hotspot.active {
    background: color-mix(in srgb, var(--vscode-focusBorder) 58%, transparent);
    outline: 1px solid var(--vscode-focusBorder);
  }

  .view-hint {
    color: var(--vscode-descriptionForeground);
    font-size: 9px;
    line-height: 1.3;
    max-width: 190px;
    margin: 0 auto 7px;
  }
</style>
