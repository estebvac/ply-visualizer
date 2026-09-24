<script lang="ts">
  import * as THREE from 'three';
  import { viewerState } from '../state/viewer.svelte';
  import { cameraQuaternionToCssMatrix3d } from '../viewCubeTransform';

  let { host }: { host: any } = $props();

  const CUBE_HALF = 38;

  type FaceSpec = {
    id: string;
    label: string;
    transform: string;
    normal: THREE.Vector3;
    right: THREE.Vector3;
    down: THREE.Vector3;
  };

  type FaceCell = {
    row: -1 | 0 | 1;
    col: -1 | 0 | 1;
    direction: THREE.Vector3;
    id: string;
    kind: 'face' | 'edge' | 'corner';
    ariaLabel: string;
  };

  const faces: FaceSpec[] = [
    {
      id: '+x',
      label: '+X',
      transform: 'rotateY(90deg) translateZ(38px)',
      normal: new THREE.Vector3(1, 0, 0),
      right: new THREE.Vector3(0, 0, -1),
      down: new THREE.Vector3(0, 1, 0),
    },
    {
      id: '-x',
      label: '−X',
      transform: 'rotateY(-90deg) translateZ(38px)',
      normal: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(0, 0, 1),
      down: new THREE.Vector3(0, 1, 0),
    },
    {
      id: '+y',
      label: '+Y',
      transform: 'rotateX(90deg) translateZ(38px)',
      normal: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      down: new THREE.Vector3(0, 0, -1),
    },
    {
      id: '-y',
      label: '−Y',
      transform: 'rotateX(-90deg) translateZ(38px)',
      normal: new THREE.Vector3(0, -1, 0),
      right: new THREE.Vector3(1, 0, 0),
      down: new THREE.Vector3(0, 0, 1),
    },
    {
      id: '+z',
      label: '+Z',
      transform: 'rotateY(0deg) translateZ(38px)',
      normal: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      down: new THREE.Vector3(0, 1, 0),
    },
    {
      id: '-z',
      label: '−Z',
      transform: 'rotateY(180deg) translateZ(38px)',
      normal: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(-1, 0, 0),
      down: new THREE.Vector3(0, 1, 0),
    },
  ];

  function directionId(direction: THREE.Vector3): string {
    const tokens: string[] = [];
    if (Math.abs(direction.x) > 1e-9) tokens.push(`${direction.x > 0 ? '+' : '-'}X`);
    if (Math.abs(direction.y) > 1e-9) tokens.push(`${direction.y > 0 ? '+' : '-'}Y`);
    if (Math.abs(direction.z) > 1e-9) tokens.push(`${direction.z > 0 ? '+' : '-'}Z`);
    return tokens.join(' ');
  }

  function cellKind(direction: THREE.Vector3): 'face' | 'edge' | 'corner' {
    const count = [direction.x, direction.y, direction.z].filter(value => Math.abs(value) > 1e-9).length;
    return count === 1 ? 'face' : count === 2 ? 'edge' : 'corner';
  }

  function cellsForFace(face: FaceSpec): FaceCell[] {
    const cells: FaceCell[] = [];
    for (const row of [-1, 0, 1] as const) {
      for (const col of [-1, 0, 1] as const) {
        const raw = face.normal
          .clone()
          .addScaledVector(face.right, col)
          .addScaledVector(face.down, row);
        const kind = cellKind(raw);
        const id = directionId(raw);
        cells.push({
          row,
          col,
          direction: raw.normalize(),
          id,
          kind,
          ariaLabel: `View from ${id}${kind === 'face' ? '' : ` ${kind}`}`,
        });
      }
    }
    return cells;
  }

  const faceCells = new Map(faces.map(face => [face.id, cellsForFace(face)]));
  let hoveredId = $state('');

  const cubeTransform = $derived.by(() => {
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

    const snapped = new THREE.Vector3(
      Math.abs(direction.x) >= 0.35 ? Math.sign(direction.x) : 0,
      Math.abs(direction.y) >= 0.35 ? Math.sign(direction.y) : 0,
      Math.abs(direction.z) >= 0.35 ? Math.sign(direction.z) : 0
    );
    return directionId(snapped);
  });

  function faceToken(faceId: string): string {
    return `${faceId[0]}${faceId[1].toUpperCase()}`;
  }

  function isFaceHighlighted(faceId: string): boolean {
    const selected = hoveredId || activeId;
    return selected ? selected.split(' ').includes(faceToken(faceId)) : false;
  }

  function snap(cell: FaceCell) {
    host.cameraViewAnimator.animateToDirection(host, cell.direction.clone());
  }

  function onCellKeydown(event: KeyboardEvent, cell: FaceCell) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      snap(cell);
    }
  }
</script>

<div class="view-cube-wrap" data-view-cube-wrap>
  <div class="view-cube-scene" aria-label="Camera view cube" data-view-cube-scene>
    <div class="view-cube" style:transform={cubeTransform} data-view-cube>
      {#each faces as face (face.id)}
        <div
          class="cube-face"
          style:transform={face.transform}
          class:highlighted={isFaceHighlighted(face.id)}
          class:active={activeId === directionId(face.normal)}
          data-view-face={face.id}
        >
          <span class="face-label">{face.label}</span>

          <div class="face-hit-grid">
            {#each faceCells.get(face.id) ?? [] as cell (`${cell.row}:${cell.col}`)}
              <button
                class="face-hit-cell"
                data-view-direction={cell.id}
                data-view-kind={cell.kind}
                data-face-owner={face.id}
                aria-label={cell.ariaLabel}
                title={cell.ariaLabel}
                onmouseenter={() => (hoveredId = cell.id)}
                onmouseleave={() => (hoveredId = '')}
                onfocus={() => (hoveredId = cell.id)}
                onblur={() => (hoveredId = '')}
                onclick={() => snap(cell)}
                onkeydown={event => onCellKeydown(event, cell)}
              ></button>
            {/each}
          </div>
        </div>
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
    width: 100%;
    min-width: 0;
    margin: 8px auto 4px;
    text-align: center;
  }

  .view-cube-scene {
    width: 136px !important;
    min-width: 136px;
    max-width: 136px;
    height: 136px !important;
    min-height: 136px;
    max-height: 136px;
    flex: 0 0 136px;
    margin: 0 auto 10px;
    perspective: 228px;
    perspective-origin: 50% 50%;
    display: grid;
    place-items: center;
    overflow: visible;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }

  .view-cube {
    position: relative;
    width: 76px;
    height: 76px;
    flex: none;
    transform-style: preserve-3d;
    transform-origin: 50% 50%;
    transition: transform 70ms linear;
    will-change: transform;
  }

  .cube-face {
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
    user-select: none;
    -webkit-user-select: none;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, white 5%, transparent);
  }

  .cube-face.highlighted,
  .cube-face.active {
    background: color-mix(
      in srgb,
      var(--vscode-button-background, #0e639c) 48%,
      var(--vscode-sideBar-background, #252526) 52%
    );
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  /* DeSandro six-plane transforms are supplied inline from FaceSpec. */
  .face-label {
    pointer-events: none;
    position: relative;
    z-index: 1;
    text-shadow: 0 1px 1px color-mix(in srgb, black 45%, transparent);
  }

  /*
   * Each actual cube face carries its own 3x3 hit grid. Center cells are axis
   * views, side cells are edge views, and corner cells are corner views.
   * There are no floating 3D buttons outside the six visible planes.
   */
  .face-hit-grid {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    z-index: 2;
  }

  .face-hit-cell {
    all: unset;
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    cursor: pointer;
    background: transparent;
    border: 0;
    outline: 0;
  }

  .face-hit-cell:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -2px;
  }

  .view-hint {
    position: relative;
    z-index: 0;
    pointer-events: none;
    color: var(--vscode-descriptionForeground, #a0a0a0);
    font-size: 9px;
    line-height: 1.35;
    max-width: 190px;
    margin: 0 auto;
  }
</style>
