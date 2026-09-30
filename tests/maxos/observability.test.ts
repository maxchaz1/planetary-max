import { describe, expect, it } from 'vitest';
import { StructuredLogger, type LogRecord, type LogSink } from '../../src/maxos/observability/logger';
import { Metrics, type MetricLabels, type MetricsBackend } from '../../src/maxos/observability/metrics';
import { TraceContext } from '../../src/maxos/observability/tracing';

class CapturingLogSink implements LogSink {
  readonly records: LogRecord[] = [];
  readonly serialized: string[] = [];

  emit(record: LogRecord, serialized: string): void {
    this.records.push(record);
    this.serialized.push(serialized);
  }
}

class CapturingMetricsBackend implements MetricsBackend {
  readonly counters: Array<{ labels: MetricLabels; name: string; value: number }> = [];
  readonly observations: Array<{ labels: MetricLabels; name: string; value: number }> = [];

  increment(name: string, value: number, labels: MetricLabels): void {
    this.counters.push({ labels, name, value });
  }

  observe(name: string, value: number, labels: MetricLabels): void {
    this.observations.push({ labels, name, value });
  }
}

describe('Phase 11 observability', () => {
  it('emits structured JSON with levels and request context', () => {
    const sink = new CapturingLogSink();
    const logger = new StructuredLogger(sink).child({ requestId: 'request-1', traceId: 'trace-1' });
    logger.debug('request.debug');
    logger.info('request.info', { lane: 'sim', sessionId: 'session-1' });
    logger.warn('request.warn');
    logger.error('request.error');
    expect(sink.records.map(({ level }) => level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(JSON.parse(sink.serialized[1])).toMatchObject({
      event: 'request.info',
      lane: 'sim',
      requestId: 'request-1',
      sessionId: 'session-1',
      traceId: 'trace-1',
    });
  });

  it('creates deterministic request traces and component spans', async () => {
    const first = await TraceContext.create('request-1');
    const second = await TraceContext.create('request-1');
    expect(first.traceId).toBe(second.traceId);
    expect(await first.startSpan('router')).toEqual(await second.startSpan('router'));
    const firstRepeated = await first.startSpan('router');
    const secondRepeated = await second.startSpan('router');
    expect(firstRepeated).toEqual(secondRepeated);
    expect(firstRepeated.spanId).not.toBe(first.metadata().spans.router);
    expect(first.metadata()).toMatchObject({
      traceId: first.traceId,
      spans: { router: expect.any(String), 'router.2': expect.any(String) },
    });
  });

  it('supports metric backends while remaining safe with the no-op default', () => {
    expect(() => new Metrics().increment('maxos_requests_total')).not.toThrow();
    const backend = new CapturingMetricsBackend();
    const metrics = new Metrics(backend);
    metrics.increment('maxos_requests_total', { lane: 'sim' });
    metrics.observe('maxos_kernel_latency_ms', 12, { status: 200 });
    expect(backend.counters).toEqual([{ labels: { lane: 'sim' }, name: 'maxos_requests_total', value: 1 }]);
    expect(backend.observations).toEqual([
      { labels: { status: 200 }, name: 'maxos_kernel_latency_ms', value: 12 },
    ]);
  });
});
