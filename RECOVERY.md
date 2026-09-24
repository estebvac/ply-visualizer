# Recovered voxel renderer and camera UI

This branch reconstructs the modified PLY Visualizer packaged on
2026-07-24 as `ply-visualizer-voxel-camera-1.6.1.vsix`.

Correct upstream source base:
`dca6d575a55128ad3b8b1b508eb885c0cf2833b5` (2026-07-17).

Exact recovered source delta:
- 9 modified source files
- 3 added source files
- 1 deleted source file
- 654 insertions
- 282 deletions

Recovered functionality:
- instanced voxel rendering and per-file voxel size
- voxel/point render-mode integration
- SolidWorks-style camera orientation selector
- ±X / ±Y / ±Z and isometric camera presets
- XYZ camera-position sliders and numeric inputs
- camera/voxel integration across transforms and sequence playback
- removal of the obsolete LiDAR web worker path present in the base

Preserved historical VSIX SHA-256:
`d22c6c60cae5a5238829f4c6539e5469804a8e640410e910d00383fd1f7647f7`

The GitHub Release asset is rebuilt from the recovered source. Its checksum
may differ from the historical VSIX because dependency installation and VSIX
packaging metadata are not guaranteed to be byte-reproducible.
