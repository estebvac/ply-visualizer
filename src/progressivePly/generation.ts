export interface ProgressiveGenerationState {
  latestGeneration: number;
}

/**
 * Advance a progressive tile stream to a camera generation.
 *
 * Returning false means the request is already obsolete and should do no I/O.
 * Repeated requests for the current generation are allowed so a bounded batch
 * can continue fetching the remaining selected tiles.
 */
export function acceptProgressiveGeneration(
  state: ProgressiveGenerationState,
  generation: number
): boolean {
  if (!Number.isFinite(generation) || generation < state.latestGeneration) {
    return false;
  }
  if (generation > state.latestGeneration) {
    state.latestGeneration = generation;
  }
  return true;
}

export function isCurrentProgressiveGeneration(
  state: ProgressiveGenerationState,
  generation: number
): boolean {
  return Number.isFinite(generation) && generation === state.latestGeneration;
}
