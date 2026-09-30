import type { JsonObject } from '../types';

export type MetricLabels = JsonObject;

export interface MetricsBackend {
  increment(name: string, value: number, labels: MetricLabels): void;
  observe(name: string, value: number, labels: MetricLabels): void;
}

export class NoopMetricsBackend implements MetricsBackend {
  increment(): void {}
  observe(): void {}
}

export class Metrics {
  constructor(private readonly backend: MetricsBackend = new NoopMetricsBackend()) {}

  increment(name: string, labels: MetricLabels = {}, value = 1): void {
    this.backend.increment(name, value, labels);
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    this.backend.observe(name, value, labels);
  }

  timer(name: string, labels: MetricLabels = {}): () => number {
    const started = performance.now();
    return () => {
      const duration = performance.now() - started;
      this.observe(name, duration, labels);
      return duration;
    };
  }
}

export const defaultMetrics = new Metrics();
