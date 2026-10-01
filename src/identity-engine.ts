// ==========================================================
// PHASE 13.2 — IDENTITY ENGINE MODULE
// Identity curvature computation and state evolution
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type IdentityState = JsonObject & {
  subject: string;
  curvature: number;
  entropyContribution: number;
  eventCount: number;
  lastEventTime: number;
};

/**
 * Compute identity curvature as a monotonic or bounded function of identity and sim state.
 * Curvature encodes the degree of alignment/deviation in the identity trajectory.
 * Returns a value in [0, 100].
 */
export function computeIdentityCurvature(
  identity: JsonObject,
  simCore: JsonObject,
): number {
  // Extract baseline curvature from identity metadata if present
  let baseCurvature = 50; // Neutral midpoint

  if (typeof identity.curvature === 'number') {
    baseCurvature = Math.max(0, Math.min(100, identity.curvature));
  }

  // Apply entropy influence from sim core
  let entropyFactor = 0;
  if (typeof simCore.entropy === 'number') {
    // Higher entropy slightly increases curvature deviation
    entropyFactor = simCore.entropy * 0.1; // Scale down to 0-10
  }

  // Compute bounded result
  const curvature = Math.max(0, Math.min(100, baseCurvature + entropyFactor));
  return Math.round(curvature * 100) / 100; // Round to 2 decimals
}

/**
 * Update identity state by processing a stream of events.
 * Must maintain monotonicity constraints as defined in kernel physics.
 */
export function updateIdentityState(
  identity: JsonObject,
  events: JsonValue[],
): IdentityState {
  const state: IdentityState = {
    subject: String(identity.subject ?? 'unknown'),
    curvature: typeof identity.curvature === 'number' ? identity.curvature : 50,
    entropyContribution: typeof identity.entropyContribution === 'number' ? identity.entropyContribution : 0,
    eventCount: Array.isArray(events) ? events.length : 0,
    lastEventTime: Date.now(),
  };

  // Process each event in order to evolve state
  if (Array.isArray(events)) {
    for (const event of events) {
      if (
        typeof event === 'object' &&
        event !== null &&
        !Array.isArray(event) &&
        'type' in event
      ) {
        const eventObj = event as Record<string, unknown>;
        // Apply event-specific state transitions here
        if (eventObj.type === 'curvature.shift' && typeof eventObj.delta === 'number') {
          const delta = eventObj.delta as number;
          state.curvature = Math.max(0, Math.min(100, state.curvature + delta));
        }
      }
    }
  }

  return state;
}

/**
 * Introspection: return current identity state for observation.
 */
export function inspectIdentity(state: IdentityState): JsonObject {
  return {
    subject: state.subject,
    curvature: state.curvature,
    entropyContribution: state.entropyContribution,
    eventCount: state.eventCount,
    lastEventTime: state.lastEventTime,
  };
}
