import { expect, it } from 'vitest';
import app from '../../src/index';
import { bindings, envelope } from './fixtures';

it('runs enforcement and orchestration before the kernel service bridge', async () => {
  let kernelEnvelope: Record<string, unknown> | undefined;
  const env = bindings(async (request) => {
    expect(request.headers.get('content-encoding')).toBeNull();
    expect(request.headers.get('idempotency-key')).toBe('integration-1');
    kernelEnvelope = await request.json<Record<string, unknown>>();
    return Response.json(
      { ok: true, result: { accepted: true } },
      { status: 202, headers: { 'content-encoding': 'identity', 'content-length': '1', 'x-kernel': 'portal' } },
    );
  });
  const response = await app.request('/api/kernel/message', {
    method: 'POST',
    headers: { 'content-encoding': 'identity', 'content-type': 'application/json' },
    body: JSON.stringify(envelope({ id: 'integration-1', type: 'tec' })),
  }, env);

  expect(response.status).toBe(202);
  expect(response.headers.get('content-encoding')).toBeNull();
  expect(response.headers.get('content-length')).toBeNull();
  expect(response.headers.get('x-kernel')).toBe('portal');
  expect(kernelEnvelope).toMatchObject({
    id: 'integration-1',
    identity: 'test-service-token',
    laneOutput: { lane: 'tec' },
    metadata: {
      enforcement: { identity: { structurallyValidated: true } },
      route: { lane: 'tec' },
      trace: {
        traceId: expect.stringMatching(/^trace_[0-9a-f]{64}$/),
        spans: {
          enforcement: expect.any(String),
          kernel: expect.any(String),
          orchestrator: expect.any(String),
          router: expect.any(String),
        },
      },
    },
  });
  expect(await response.json()).toEqual({
    ok: true,
    messageId: 'integration-1',
    status: 202,
    data: { ok: true, result: { accepted: true } },
  });
});

it('preserves kernel null-body statuses without parsing a response body', async () => {
  const response = await app.request('/api/kernel/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope({ id: 'integration-no-content' })),
  }, bindings(async () => new Response(null, { status: 204, headers: { 'x-kernel': 'portal' } })));

  expect(response.status).toBe(204);
  expect(response.headers.get('x-kernel')).toBe('portal');
  expect(await response.text()).toBe('');
});

it('isolates circuit state between kernel service bindings', async () => {
  const failing = bindings(async () => Response.json({ ok: false }, { status: 503 }));
  failing.MAX_RETRY_ATTEMPTS = '1';
  failing.CIRCUIT_FAILURE_THRESHOLD = '1';
  const failure = await app.request('/api/kernel/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope({ id: 'circuit-service-a' })),
  }, failing);
  expect(failure.status).toBe(503);

  const healthy = bindings(async () => Response.json({ ok: true }, { status: 200 }));
  healthy.MAX_RETRY_ATTEMPTS = '1';
  healthy.CIRCUIT_FAILURE_THRESHOLD = '1';
  const success = await app.request('/api/kernel/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope({ id: 'circuit-service-b' })),
  }, healthy);
  expect(success.status).toBe(200);
});

it('cancels transient kernel response bodies before retrying', async () => {
  let attempts = 0;
  let canceled = false;
  const env = bindings(async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(new ReadableStream({
        cancel() {
          canceled = true;
        },
      }), { status: 503 });
    }
    return Response.json({ ok: true });
  });
  env.MAX_RETRY_ATTEMPTS = '2';

  const response = await app.request('/api/kernel/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope({ id: 'kernel-retry-cancel' })),
  }, env);

  expect(response.status).toBe(200);
  expect(attempts).toBe(2);
  expect(canceled).toBe(true);
});
