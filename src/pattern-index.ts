// ==========================================================
// PHASE 13.4b — PATTERN INDEX MODULE
// Event pattern indexing and querying
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type Pattern = JsonObject & {
  id: string;
  type: string;
  timestamp: number;
  payload: JsonValue;
  metadata: JsonObject;
};

export type PatternQuery = JsonObject & {
  type?: string;
  after?: number;
  before?: number;
  limit?: number;
};

// In-memory pattern store (in production, this would be backed by durable storage)
const patternIndex = new Map<string, Pattern>();
let patternIdCounter = 0;

/**
 * Index a single event into the pattern index.
 * Extracts event metadata and stores for later querying.
 */
export function indexPattern(event: JsonValue, context: JsonObject): Pattern {
  const pattern: Pattern = {
    id: `pattern-${patternIdCounter++}`,
    type: typeof event === 'object' && event !== null && !Array.isArray(event) 
      ? String((event as Record<string, unknown>).type ?? 'unknown')
      : 'unknown',
    timestamp: Date.now(),
    payload: event,
    metadata: {
      source: 'kernel',
      indexed: true,
      ...context,
    },
  };

  patternIndex.set(pattern.id, pattern);
  return pattern;
}

/**
 * Query patterns from the index based on criteria.
 * Supports filtering by type, time range, and result limit.
 */
export function queryPatterns(criteria: PatternQuery): JsonValue[] {
  const results: Pattern[] = [];
  const limit = typeof criteria.limit === 'number' ? criteria.limit : 100;

  for (const [, pattern] of patternIndex) {
    // Filter by type
    if (criteria.type && pattern.type !== criteria.type) continue;

    // Filter by time range
    if (criteria.after && pattern.timestamp < criteria.after) continue;
    if (criteria.before && pattern.timestamp > criteria.before) continue;

    results.push(pattern);

    // Respect limit
    if (results.length >= limit) break;
  }

  return results.map((p) => ({
    id: p.id,
    type: p.type,
    timestamp: p.timestamp,
    metadata: p.metadata,
  }));
}

/**
 * Clear the pattern index (useful for testing or reset).
 */
export function clearPatternIndex(): void {
  patternIndex.clear();
  patternIdCounter = 0;
}

/**
 * Introspection: return pattern index stats.
 */
export function inspectPatternIndex(): JsonObject {
  return {
    patternCount: patternIndex.size,
    nextId: patternIdCounter,
  };
}
