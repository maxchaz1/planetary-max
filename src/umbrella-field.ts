// ==========================================================
// PHASE 13.3 — UMBRELLA FIELD / PATH MODULE
// Governance field resolution and path computation
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type UmbrellaField = JsonObject & {
  mode: 'strict' | 'advisory' | 'off';
  enforcement: 'strict' | 'advisory' | 'off';
  admitLanes: string[];
  deniedLanes: string[];
};

export type UmbrellaPath = JsonObject & {
  route: string[];
  waypoints: Array<{ name: string; governance: string }>;
  destination: string;
  viableAlternatives: string[];
};

/**
 * Resolve the umbrella field from kernel context.
 * Determines which lanes are admitted, denied, or advisory based on governance context.
 */
export function resolveUmbrellaField(context: {
  governanceContext: JsonObject;
  umbrellaMode: string;
  identity: string;
}): UmbrellaField {
  const mode = (
    context.umbrellaMode === 'strict' ||
    context.umbrellaMode === 'advisory' ||
    context.umbrellaMode === 'off'
      ? context.umbrellaMode
      : 'strict'
  ) as 'strict' | 'advisory' | 'off';

  // Extract lane admissions from governance context
  const admitLanes = Array.isArray((context.governanceContext as Record<string, unknown>).allowedLanes)
    ? ((context.governanceContext as Record<string, unknown>).allowedLanes as string[])
    : [];
  const deniedLanes = Array.isArray((context.governanceContext as Record<string, unknown>).deniedLanes)
    ? ((context.governanceContext as Record<string, unknown>).deniedLanes as string[])
    : [];

  return {
    mode,
    enforcement: mode,
    admitLanes,
    deniedLanes,
  };
}

/**
 * Resolve the umbrella path through the kernel lanes.
 * Maps the message route into an ordered sequence of governance waypoints.
 */
export function resolveUmbrellaPath(context: {
  laneRouting: JsonObject;
  governanceContext: JsonObject;
  umbrellaMode: string;
}): UmbrellaPath {
  const routing = context.laneRouting as Record<string, unknown>;
  const routeArray = Array.isArray(routing.route) ? (routing.route as string[]) : [];
  const destination = String(routing.lane ?? routeArray[routeArray.length - 1] ?? 'unknown');

  // Construct waypoints from route
  const waypoints = routeArray.map((lane, index) => ({
    name: String(lane),
    governance:
      index === 0 ? 'entry' : index === routeArray.length - 1 ? 'exit' : 'transit',
  }));

  return {
    route: routeArray,
    waypoints,
    destination,
    viableAlternatives: [], // Can be populated from governance context
  };
}

/**
 * Check if a lane is admitted under current umbrella field.
 */
export function isLaneAdmitted(field: UmbrellaField, laneName: string): boolean {
  if (field.mode === 'off') return true; // Off mode admits all lanes
  if (field.deniedLanes.includes(laneName)) return false; // Explicit denial
  if (field.admitLanes.length === 0) return true; // No allow-list; permit by default
  return field.admitLanes.includes(laneName); // Check allow-list
}

/**
 * Introspection: return umbrella state for observation.
 */
export function inspectUmbrellaField(field: UmbrellaField): JsonObject {
  return {
    mode: field.mode,
    enforcement: field.enforcement,
    admitCount: field.admitLanes.length,
    denyCount: field.deniedLanes.length,
  };
}
