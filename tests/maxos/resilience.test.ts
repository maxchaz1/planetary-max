import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/maxos/resilience/circuit';
import { IdentityError, KernelError, toErrorResponse } from '../../src/maxos/resilience/errors';
import { retry } from '../../src/maxos/resilience/retries';
import { kernelTimeout, withTimeout } from '../../src/maxos/resilience/timeouts';

describe('Phase 11 resilience', () => {
  it('enforces explicit timeouts with normalized kernel errors', async () => {
    await expect(withTimeout(
      () => new Promise<never>(() => {}),
      { timeoutMs: 5, createError: () => kernelTimeout(5) },
    )).rejects.toMatchObject({ code: 'KERNEL_TIMEOUT', retryable: true, status: 503 });
  });

  it('preserves the configured timeout error when abort listeners reject', async () => {
    await expect(withTimeout(
      (signal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
      { timeoutMs: 5, createError: () => kernelTimeout(5) },
    )).rejects.toMatchObject({ code: 'KERNEL_TIMEOUT', retryable: true, status: 503 });
  });

  it('bounds retries and applies exponential backoff only to transient errors', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new KernelError('transient', 'KERNEL_UNAVAILABLE', 503, true);
        return 'ok';
      },
      { baseDelayMs: 2, maxAttempts: 3 },
      {
        shouldRetry: (error) => error instanceof KernelError && error.retryable,
        sleep: async (delayMs) => { delays.push(delayMs); },
      },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([2, 4]);

    attempts = 0;
    delays.length = 0;
    await expect(retry(
      async () => {
        attempts += 1;
        throw new KernelError('transient', 'KERNEL_UNAVAILABLE', 503, true);
      },
      { baseDelayMs: 20, maxAttempts: 3, maxDelayMs: 25 },
      {
        shouldRetry: (error) => error instanceof KernelError && error.retryable,
        sleep: async (delayMs) => { delays.push(delayMs); },
      },
    )).rejects.toBeInstanceOf(KernelError);
    expect(delays).toEqual([20, 25]);

    attempts = 0;
    await expect(retry(
      async () => {
        attempts += 1;
        throw new IdentityError('denied');
      },
      { baseDelayMs: 1, maxAttempts: 3 },
      { shouldRetry: (error) => error instanceof KernelError && error.retryable, sleep: async () => {} },
    )).rejects.toBeInstanceOf(IdentityError);
    expect(attempts).toBe(1);
  });

  it('opens, half-opens, and closes the kernel circuit', async () => {
    let now = 1_000;
    const states: string[] = [];
    const circuit = new CircuitBreaker({ cooldownMs: 100, failureThreshold: 2 }, () => now);
    const fail = async (): Promise<never> => { throw new Error('offline'); };
    await expect(circuit.execute(fail)).rejects.toThrow('offline');
    await expect(circuit.execute(fail, { onStateChange: (state) => states.push(state) })).rejects.toThrow('offline');
    expect(circuit.state).toBe('open');
    await expect(circuit.execute(async () => 'blocked')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    now = 1_101;
    await expect(circuit.execute(async () => 'recovered', { onStateChange: (state) => states.push(state) }))
      .resolves.toBe('recovered');
    expect(circuit.state).toBe('closed');
    expect(states).toEqual(['open', 'half-open', 'closed']);
  });

  it('allows only one half-open probe', async () => {
    let now = 0;
    const circuit = new CircuitBreaker({ cooldownMs: 10, failureThreshold: 1 }, () => now);
    await expect(circuit.execute(async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    now = 10;

    let releaseProbe: (() => void) | undefined;
    const probe = circuit.execute(() => new Promise<void>((resolve) => {
      releaseProbe = resolve;
    }));
    await Promise.resolve();

    await expect(circuit.execute(async () => undefined)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    releaseProbe?.();
    await probe;
    expect(circuit.state).toBe('closed');
  });

  it('does not let an earlier in-flight success close a newly opened circuit', async () => {
    const circuit = new CircuitBreaker({ cooldownMs: 10, failureThreshold: 1 });
    let resolveStale: ((value: string) => void) | undefined;
    const staleSuccess = circuit.execute(() => new Promise<string>((resolve) => {
      resolveStale = resolve;
    }));
    await Promise.resolve();
    await expect(circuit.execute(async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(circuit.state).toBe('open');

    resolveStale?.('stale success');
    await expect(staleSuccess).resolves.toBe('stale success');
    expect(circuit.state).toBe('open');
  });

  it('normalizes errors without exposing stack traces', async () => {
    const response = toErrorResponse(new KernelError('Kernel unavailable', 'KERNEL_UNAVAILABLE'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      status: 503,
      error: { code: 'KERNEL_UNAVAILABLE', message: 'Kernel unavailable' },
    });
  });
});
