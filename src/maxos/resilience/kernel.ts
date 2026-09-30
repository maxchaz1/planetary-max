import type { ObservabilityContext } from '../observability/tracing';
import type { OrchestratedEnvelope } from '../types';
import { CircuitBreaker, type CircuitConfig } from './circuit';
import { KernelError, MaxOsError } from './errors';
import { retry, type RetryPolicy } from './retries';
import { kernelTimeout, withTimeout } from './timeouts';

export type KernelClientConfig = {
  circuit: CircuitConfig;
  retry: RetryPolicy;
  timeoutMs: number;
};

const circuits = new WeakMap<Fetcher, Map<string, CircuitBreaker>>();

function circuitFor(service: Fetcher, config: CircuitConfig): CircuitBreaker {
  const key = `${config.failureThreshold}:${config.cooldownMs}`;
  const serviceCircuits = circuits.get(service) ?? new Map<string, CircuitBreaker>();
  const current = serviceCircuits.get(key) ?? new CircuitBreaker(config);
  serviceCircuits.set(key, current);
  circuits.set(service, serviceCircuits);
  return current;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class KernelClient {
  private readonly circuit: CircuitBreaker;

  constructor(
    private readonly service: Fetcher,
    private readonly config: KernelClientConfig,
    private readonly observability: ObservabilityContext,
  ) {
    this.circuit = circuitFor(service, config.circuit);
  }

  async fetch(url: string, requestHeaders: Headers, envelope: OrchestratedEnvelope): Promise<Response> {
    const span = await this.observability.trace.startSpan('kernel', { lane: envelope.metadata.route.lane });
    envelope.metadata.trace = this.observability.trace.metadata();
    const stopTimer = this.observability.metrics.timer('maxos_kernel_latency_ms', {
      lane: envelope.metadata.route.lane,
    });
    const headers = new Headers(requestHeaders);
    headers.set('content-type', 'application/json');
    headers.set('idempotency-key', envelope.id);
    headers.delete('content-encoding');
    headers.delete('content-length');
    const body = JSON.stringify({ ...envelope, identity: envelope.identity.credential });
    try {
      const response = await this.circuit.execute(
        () => retry(
          async () => {
            try {
              const result = await withTimeout(
                (signal) => this.service.fetch(new Request(url, { method: 'POST', headers, body, signal })),
                { timeoutMs: this.config.timeoutMs, createError: () => kernelTimeout(this.config.timeoutMs) },
              );
              if (isTransientStatus(result.status)) {
                await result.body?.cancel();
                throw new KernelError('Kernel returned a transient failure', 'KERNEL_UNAVAILABLE', 503, true);
              }
              return result;
            } catch (error) {
              if (error instanceof MaxOsError) throw error;
              throw new KernelError('Kernel service is unavailable', 'KERNEL_UNAVAILABLE', 503, true);
            }
          },
          this.config.retry,
          {
            shouldRetry: (error) => error instanceof KernelError && error.retryable,
            onRetry: (attempt, delayMs) => {
              this.observability.metrics.increment('maxos_kernel_retries_total');
              this.observability.logger.warn('kernel.retry', { attempt, delayMs, spanId: span.spanId });
            },
          },
        ),
        {
          onStateChange: (state) => {
            this.observability.metrics.increment('maxos_kernel_circuit_transitions_total', { state });
            this.observability.logger.warn('kernel.circuit.state', { circuitState: state, spanId: span.spanId });
          },
        },
      );
      const latencyMs = stopTimer();
      this.observability.logger.info('kernel.response', {
        kernelStatus: response.status,
        lane: envelope.metadata.route.lane,
        latencyMs,
        sessionId: envelope.sessionId,
        spanId: span.spanId,
      });
      return response;
    } catch (error) {
      stopTimer();
      this.observability.metrics.increment('maxos_failures_total', { stage: 'kernel' });
      throw error;
    }
  }
}
