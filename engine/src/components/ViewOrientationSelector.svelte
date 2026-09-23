<script lang="ts">
  import type { CameraPreset } from '../cameraViews';
  import { applyCameraPreset } from '../cameraViews';

  let { host }: { host: any } = $props();

  const views: Array<{ preset: CameraPreset; label: string; title: string; cls: string }> = [
    { preset: 'positive-z', label: '+Z', title: 'View from +Z toward the rotation center', cls: 'top' },
    { preset: 'negative-z', label: '−Z', title: 'View from −Z toward the rotation center', cls: 'bottom' },
    { preset: 'negative-x', label: '−X', title: 'View from −X toward the rotation center', cls: 'left' },
    { preset: 'positive-x', label: '+X', title: 'View from +X toward the rotation center', cls: 'right' },
    { preset: 'positive-y', label: '+Y', title: 'View from +Y toward the rotation center', cls: 'front' },
    { preset: 'negative-y', label: '−Y', title: 'View from −Y toward the rotation center', cls: 'back' },
    { preset: 'isometric', label: 'ISO', title: 'Isometric view from +X, −Y, +Z', cls: 'iso' },
    {
      preset: 'isometric-opposite',
      label: 'ISO↺',
      title: 'Opposite isometric view from −X, +Y, +Z',
      cls: 'iso-opposite',
    },
  ];
</script>

<div class="orientation-selector" aria-label="Camera view orientation selector">
  <div class="orientation-cube" aria-hidden="true">
    <div class="cube-top"></div>
    <div class="cube-left"></div>
    <div class="cube-right"></div>
  </div>
  {#each views as view (view.preset)}
    <button
      class={`view-button ${view.cls}`}
      title={view.title}
      aria-label={view.title}
      onclick={() => applyCameraPreset(host, view.preset)}
    >{view.label}</button>
  {/each}
</div>

<div class="view-hint">Each axis means “camera located on this side, looking at the current rotation center.”</div>

<style>
  .orientation-selector {
    position: relative;
    width: 184px;
    height: 148px;
    margin: 6px auto 2px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 5px;
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
  }

  .orientation-cube {
    position: absolute;
    left: 72px;
    top: 54px;
    width: 40px;
    height: 40px;
  }

  .cube-top,
  .cube-left,
  .cube-right {
    position: absolute;
    border: 1px solid var(--vscode-foreground);
    opacity: 0.34;
  }

  .cube-top {
    width: 36px;
    height: 24px;
    left: 2px;
    top: -11px;
    transform: skewY(-28deg) scaleY(0.7);
    background: var(--vscode-button-background);
  }

  .cube-left {
    width: 20px;
    height: 34px;
    left: 1px;
    top: 8px;
    transform: skewY(28deg);
    background: var(--vscode-button-secondaryBackground);
  }

  .cube-right {
    width: 20px;
    height: 34px;
    right: 0;
    top: 8px;
    transform: skewY(-28deg);
    background: var(--vscode-button-background);
  }

  .view-button {
    position: absolute;
    min-width: 34px;
    height: 24px;
    padding: 2px 5px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font-size: 9px;
    cursor: pointer;
  }

  .view-button:hover {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .top { left: 75px; top: 8px; }
  .bottom { left: 75px; bottom: 7px; }
  .left { left: 7px; top: 62px; }
  .right { right: 7px; top: 62px; }
  .front { left: 75px; top: 61px; z-index: 2; }
  .back { left: 75px; top: 96px; }
  .iso { right: 7px; top: 8px; }
  .iso-opposite { left: 7px; top: 8px; }

  .view-hint {
    color: var(--vscode-descriptionForeground);
    font-size: 9px;
    line-height: 1.3;
    text-align: center;
    margin-bottom: 7px;
  }
</style>
