// ==========================================================
// PHASE 13.5 — TELEMETRY MODULE
// Emission of kernel events for monitoring and observability
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type TelemetryEvent = JsonObject & {
  id: string;
  timestamp: number;
  type: 'result' | 'failure' | 'governance' | 'identity' | 'sim';
  data: JsonValue;
};

// In-memory telemetry buffer (in production: stream to external service)
const telemetryBuffer: TelemetryEvent[] = [];
const MAX_BUFFER_SIZE = 10000;

/**
 * Emit a telemetry event from a KernelResult or failure.
 * Events are buffered in memory and can be exported or streamed.
 */
export function emitTelemetry(event: JsonObject): void {
  const telemetryEvent: TelemetryEvent = {
    id: `tel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    type: determineEventType(event),
    data: event,
  };

  telemetryBuffer.push(telemetryEvent);

  // Maintain buffer size
  if (telemetryBuffer.length > MAX_BUFFER_SIZE) {
    telemetryBuffer.shift();
  }
}

/**
 * Determine event type from the kernel result shape.
 */
function determineEventType(event: JsonObject): TelemetryEvent['type'] {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return 'result';
  }

  const eventObj = event as Record<string, unknown>;

  if (eventObj.ok === false && eventObj.error) return 'failure';
  if (eventObj.governance) return 'governance';
  if (eventObj.identity) return 'identity';
  if (eventObj.simCore || eventObj.entropy) return 'sim';

  return 'result';
}

/**
 * Query telemetry buffer with optional filtering.
 */
export function queryTelemetry(criteria: {
  type?: TelemetryEvent['type'];
  after?: number;
  limit?: number;
}): TelemetryEvent[] {
  let results = telemetryBuffer.slice();

  if (criteria.type) {
    results = results.filter((e) => e.type === criteria.type);
  }

  if (criteria.after) {
    results = results.filter((e) => e.timestamp > criteria.after);
  }

  if (criteria.limit) {
    results = results.slice(-criteria.limit);
  }

  return results;
}

/**
 * Export telemetry buffer for external streaming or logging.
 */
export function exportTelemetry(): JsonObject {
  return {
    eventCount: telemetryBuffer.length,
    oldestEvent: telemetryBuffer[0]?.timestamp ?? null,
    newestEvent: telemetryBuffer[telemetryBuffer.length - 1]?.timestamp ?? null,
    events: telemetryBuffer.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
    })),
  };
}

/**
 * Clear the telemetry buffer (useful for testing or reset).
 */
export function clearTelemetry(): void {
  telemetryBuffer.length = 0;
}
