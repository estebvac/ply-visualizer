import * as THREE from 'three';

const DEFAULT_VOXEL_SIZE = 0.1;

function sourceColorAt(points: THREE.Points, index: number, target: THREE.Color): THREE.Color {
  const geometry = points.geometry as THREE.BufferGeometry;
  const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (colorAttribute && index < colorAttribute.count) {
    target.fromBufferAttribute(colorAttribute, index);
    const pointMaterial = points.material as THREE.PointsMaterial;
    if (pointMaterial.userData.srgbDecode) {
      target.convertSRGBToLinear();
    }
    return target;
  }

  return target.copy((points.material as THREE.PointsMaterial).color);
}

export function createVoxelMesh(points: THREE.Points, voxelSize: number): THREE.InstancedMesh {
  const sourceGeometry = points.geometry as THREE.BufferGeometry;
  const positions = sourceGeometry.getAttribute('position') as THREE.BufferAttribute;
  const size = Number.isFinite(voxelSize) && voxelSize > 0 ? voxelSize : DEFAULT_VOXEL_SIZE;

  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const voxels = new THREE.InstancedMesh(geometry, material, positions.count);
  voxels.name = `${points.name || 'Point cloud'} voxels`;
  voxels.userData.voxelSize = size;

  const matrix = new THREE.Matrix4();
  for (let i = 0; i < positions.count; i++) {
    matrix.makeTranslation(positions.getX(i), positions.getY(i), positions.getZ(i));
    voxels.setMatrixAt(i, matrix);
  }
  voxels.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  voxels.instanceMatrix.needsUpdate = true;
  voxels.computeBoundingBox();
  voxels.computeBoundingSphere();

  refreshVoxelColors(voxels, points);
  return voxels;
}

export function refreshVoxelColors(voxels: THREE.InstancedMesh, points: THREE.Points): void {
  const positions = (points.geometry as THREE.BufferGeometry).getAttribute(
    'position'
  ) as THREE.BufferAttribute;
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    voxels.setColorAt(i, sourceColorAt(points, i, color));
  }
  if (voxels.instanceColor) {
    voxels.instanceColor.setUsage(THREE.StaticDrawUsage);
    voxels.instanceColor.needsUpdate = true;
  }
}

export function updateVoxelSize(voxels: THREE.InstancedMesh, voxelSize: number): void {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    return;
  }
  const oldSize = voxels.userData.voxelSize || DEFAULT_VOXEL_SIZE;
  const ratio = voxelSize / oldSize;
  (voxels.geometry as THREE.BufferGeometry).scale(ratio, ratio, ratio);
  voxels.userData.voxelSize = voxelSize;
  voxels.computeBoundingBox();
  voxels.computeBoundingSphere();
}

export function disposeVoxelMesh(voxels: THREE.InstancedMesh): void {
  voxels.geometry.dispose();
  if (Array.isArray(voxels.material)) {
    voxels.material.forEach(material => material.dispose());
  } else {
    voxels.material.dispose();
  }
  voxels.dispose();
}
