// ==========================================================
// PHASE 13.4 — COLLAPSE VECTOR MODULE
// State collapse and waveform reduction
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type CollapseVector = JsonObject & {
  magnitude: number;
  direction: string;
  basis: string[];
  timestamp: number;
};

/**
 * Compute collapse vector from sim core and identity state.
 * The collapse vector represents the rate and direction of state reduction
 * as the system evolves toward deterministic outcomes.
 */
export function computeCollapseVector(
  simCore: JsonObject,
  identity: JsonObject,
): CollapseVector {
  const simTick = typeof simCore.tick === 'number' ? simCore.tick : 0;
  const simEntropy = typeof simCore.entropy === 'number' ? simCore.entropy : 0;
  const identityCurvature = typeof identity.curvature === 'number' ? identity.curvature : 50;

  // Compute magnitude as a function of entropy and curvature
  // Higher entropy = higher collapse (waveform spreading)
  // Higher curvature magnitude = higher collapse direction specificity
  const magnitude = Math.abs(simEntropy - 50) * 0.02 + (identityCurvature / 100) * 0.5;

  // Direction encode based on curvature and entropy
  const direction =
    identityCurvature > 50 && simEntropy > 50
      ? 'expansion'
      : identityCurvature < 50 && simEntropy < 50
        ? 'contraction'
        : 'neutral';

  // Basis vectors encode the dominant state dimensions
  const basis = [
    `tick:${simTick % 10}`,
    `entropy:${Math.round(simEntropy)}`,
    `curvature:${Math.round(identityCurvature)}`,
  ];

  return {
    magnitude: Math.round(magnitude * 1000) / 1000,
    direction,
    basis,
    timestamp: Date.now(),
  };
}

/**
 * Introspection: return collapse vector for observation.
 */
export function inspectCollapseVector(vector: CollapseVector): JsonObject {
  return {
    magnitude: vector.magnitude,
    direction: vector.direction,
    basis: vector.basis,
    timestamp: vector.timestamp,
  };
}
