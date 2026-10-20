import type { SpatialData } from '../../engine/src/interfaces';
import { detectFileTypeWithContent, parseFileData } from '../../engine/src/fileHandler';

/**
 * Classify an NPZ by its member names. Only semantic occupancy archives take
 * the sparse point-cloud path; regular depth NPZ files remain depth images.
 * Missing required semantic palette fields fail in the specialized decoder,
 * rather than being accidentally interpreted as camera depth.
 */
export async function tryDecodeSemanticNpz(
  bytes: Uint8Array,
  fileName: string
): Promise<SpatialData | null> {
  const fileType = await detectFileTypeWithContent(fileName, bytes);
  if (fileType?.extension !== 'npz' || fileType.category !== 'pointCloud') {
    return null;
  }
  const result = await parseFileData(bytes, fileType, fileName);
  if (result.type !== 'spatialData') {
    throw new Error('Sparse semantic occupancy decoder returned an unexpected result');
  }
  return result.data;
}
