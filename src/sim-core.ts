// ==========================================================
// PHASE 13.1 — SIM CORE MODULE
// Simulation core state machine and progression engine
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type SimCoreState = JsonObject & {
  tick: number;
  epoch: number;
  entropy: number;
  metrics: {
    processingTime: number;
    stateSize: number;
    lastUpdate: number;
  };
};

/**
 * Initialize a new sim core state within a kernel context.
 * Called once at kernel boot to establish the initial simulation state.
 */
export function initializeSimCore(context: {
  identity: string;
  governanceContext: JsonObject;
  planetaryMode: string;
  umbrellaMode: string;
}): SimCoreState {
  return {
    tick: 0,
    epoch: Date.now(),
    entropy: 0,
    metrics: {
      processingTime: 0,
      stateSize: 0,
      lastUpdate: Date.now(),
    },
    context: {
      identity: context.identity,
      mode: context.planetaryMode,
      umbrella: context.umbrellaMode,
    },
  };
}

/**
 * Advance sim core state by one step.
 * Called on each lane execution to update sim state and compute derived properties.
 * Must return a JSON-safe SimCoreState.
 */
export function stepSimCore(state: SimCoreState, input: JsonValue): SimCoreState {
  const startTime = performance.now();

  // Increment tick and entropy
  const newState: SimCoreState = structuredClone(state);
  newState.tick += 1;
  newState.entropy = (newState.entropy + 0.01) % 100; // Bounded entropy

  // Process input payload if it contains sim directives
  if (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    'simDirective' in input
  ) {
    const directive = (input as Record<string, unknown>).simDirective;
    if (typeof directive === 'object' && directive !== null && !Array.isArray(directive)) {
      // Update metrics or state from directive
      Object.assign(newState, directive);
    }
  }

  // Update metrics
  newState.metrics.processingTime = performance.now() - startTime;
  newState.metrics.lastUpdate = Date.now();
  newState.metrics.stateSize = JSON.stringify(newState).length;

  return newState;
}

/**
 * Query current sim state for introspection.
 */
export function inspectSimCore(state: SimCoreState): JsonObject {
  return {
    tick: state.tick,
    entropy: state.entropy,
    epoch: state.epoch,
    metrics: state.metrics,
  };
}
