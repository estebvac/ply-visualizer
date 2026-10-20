import type { SpatialData } from '../interfaces';
import { parseSemanticOccupancyNpzWasm } from './pointcloudWasm';

/**
 * Dataset-independent ds_lidar_processing sparse semantic occupancy reader.
 * All point colors come from the embedded NPZ palette; the extension knows
 * neither semantic class IDs nor their RGB values. Unknown cells are excluded
 * to match the companion PLY; they remain in the NPZ.
 */
export class SemanticOccupancyNpzParser {
  async parse(data: Uint8Array, timingCallback?: (message: string) => void): Promise<SpatialData> {
    const t0 = performance.now();
    const parsed = await parseSemanticOccupancyNpzWasm(data);
    timingCallback?.(
      `Semantic occupancy NPZ: ${parsed.vertexCount.toLocaleString()} colored voxels (${(performance.now() - t0).toFixed(1)}ms)`
    );
    return {
      vertices: [],
      faces: [],
      format: 'binary_little_endian',
      version: '1.0',
      comments: ['Sparse semantic occupancy, voxel centers; per-class RGB from NPZ palette'],
      vertexCount: parsed.vertexCount,
      faceCount: 0,
      hasColors: true,
      hasNormals: false,
      positionsArray: parsed.positionsArray,
      colorsArray: parsed.colorsArray,
      scalarFields: parsed.scalarFields,
      sourcePointCount: parsed.sourcePointCount,
      sourcePointIndices: parsed.sourcePointIndices,
      sourceRowsIdentity: parsed.sourceRowsIdentity,
      metadata: JSON.parse(parsed.metadataJson) as Record<string, unknown>,
      useTypedArrays: true,
    };
  }
}
