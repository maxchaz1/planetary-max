import { Hono } from 'hono';
import { createEnforcementMiddleware } from './maxos/middleware/enforcement';
import { defaultLogger } from './maxos/observability/logger';
import { defaultMetrics } from './maxos/observability/metrics';
import { KernelError, MaxOsError, toErrorResponse } from './maxos/resilience/errors';
import { KernelClient } from './maxos/resilience/kernel';
import { parsePositiveInteger } from './maxos/resilience/timeouts';
import { SessionOrchestrator } from './maxos/session/orchestrator';
import { createDurableSubstrate } from './maxos/state/substrate';
import type { MaxOsHonoEnv } from './maxos/types';

const app = new Hono<MaxOsHonoEnv>();

app.use('*', createEnforcementMiddleware(defaultLogger, defaultMetrics));
app.all('*', async (c) => {
  const observability = c.get('maxosObservability');
  try {
    const maxAttempts = parsePositiveInteger(c.env.MAX_RETRY_ATTEMPTS, 'MAX_RETRY_ATTEMPTS', 10);
    const retryBaseDelayMs = parsePositiveInteger(c.env.RETRY_BASE_DELAY_MS, 'RETRY_BASE_DELAY_MS', 10_000);
    const substrate = createDurableSubstrate(c.env.MAXOS_STATE, {
      observability,
      retry: { baseDelayMs: retryBaseDelayMs, maxAttempts },
      timeoutMs: parsePositiveInteger(c.env.SUBSTRATE_TIMEOUT_MS, 'SUBSTRATE_TIMEOUT_MS'),
    });
    const orchestrator = new SessionOrchestrator(substrate);
    const envelope = await orchestrator.routeEnvelope(c.get('maxosEnvelope'), c.env);
    const kernelClient = new KernelClient(
      c.env.KERNEL_SERVICE,
      {
        circuit: {
          cooldownMs: parsePositiveInteger(c.env.CIRCUIT_COOLDOWN_MS, 'CIRCUIT_COOLDOWN_MS'),
          failureThreshold: parsePositiveInteger(c.env.CIRCUIT_FAILURE_THRESHOLD, 'CIRCUIT_FAILURE_THRESHOLD', 100),
        },
        retry: { baseDelayMs: retryBaseDelayMs, maxAttempts },
        timeoutMs: parsePositiveInteger(c.env.KERNEL_TIMEOUT_MS, 'KERNEL_TIMEOUT_MS'),
      },
      observability,
    );
    const kernel = await kernelClient.fetch(c.req.url, c.req.raw.headers, envelope);
    const responseHeaders = new Headers(kernel.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    if ([204, 205, 304].includes(kernel.status)) {
      return new Response(null, { status: kernel.status, headers: responseHeaders });
    }
    const normalized = orchestrator.normalizeKernelResponse(
      await kernel.json<unknown>(),
      envelope,
      kernel.status,
    );
    responseHeaders.set('content-type', 'application/json');
    return Response.json(normalized, {
      status: kernel.status,
      headers: responseHeaders,
    });
  } catch (error) {
    observability.metrics.increment('maxos_failures_total', { stage: 'worker' });
    observability.logger.error('request.failed', {
      errorCode: error instanceof MaxOsError ? error.code : 'KERNEL_UNAVAILABLE',
    });
    return toErrorResponse(
      error instanceof SyntaxError
        ? new KernelError('Kernel returned invalid JSON', 'KERNEL_INVALID_RESPONSE', 502)
        : error,
    );
  }
});

export { app };
export default app;
