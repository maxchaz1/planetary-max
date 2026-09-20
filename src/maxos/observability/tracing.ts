import { deterministicId } from '../stable';
import type { JsonObject, TraceMetadata } from '../types';
import type { StructuredLogger } from './logger';
import type { Metrics } from './metrics';

export type TraceSpan = {
  name: string;
  spanId: string;
  traceId: string;
};

export class TraceContext {
  private readonly spans = new Map<string, string>();
  private readonly spanCounts = new Map<string, number>();

  private constructor(
    readonly requestId: string,
    readonly traceId: string,
  ) {}

  static async create(requestId: string): Promise<TraceContext> {
    return new TraceContext(requestId, await deterministicId('trace', { requestId }));
  }

  async startSpan(name: string, attributes: JsonObject = {}): Promise<TraceSpan> {
    const occurrence = (this.spanCounts.get(name) ?? 0) + 1;
    this.spanCounts.set(name, occurrence);
    const spanId = await deterministicId('span', { attributes, name, occurrence, traceId: this.traceId });
    const metadataKey = occurrence === 1 ? name : `${name}.${occurrence}`;
    this.spans.set(metadataKey, spanId);
    return { name, spanId, traceId: this.traceId };
  }

  metadata(): TraceMetadata {
    return {
      traceId: this.traceId,
      spans: Object.fromEntries([...this.spans.entries()].sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))),
    };
  }
}

export type ObservabilityContext = {
  logger: StructuredLogger;
  metrics: Metrics;
  trace: TraceContext;
};

export async function createObservabilityContext(
  requestId: string,
  logger: StructuredLogger,
  metrics: Metrics,
): Promise<ObservabilityContext> {
  const trace = await TraceContext.create(requestId);
  return {
    logger: logger.child({ requestId, traceId: trace.traceId }),
    metrics,
    trace,
  };
}
