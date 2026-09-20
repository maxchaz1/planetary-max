import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bindings, KernelEnvelope } from './contracts';
import { callKernel } from './kernel-bridge';

vi.mock('./kernel-bridge', () => ({ callKernel: vi.fn() }));

import { app } from './index';

const env: Bindings = {
  PLANETARY_MODE: 'single',
  UMBRELLA_ENFORCEMENT: 'strict',
};

const callKernelMock = vi.mocked(callKernel);

function kernelSuccess(envelope: KernelEnvelope): Response {
  return Response.json({
    ok: true,
    messageId: envelope.id,
    type: envelope.type,
    identity: envelope.identity,
    route: ['test-lane'],
    result: {
      lanes: [
        {
          lane: 'test-lane',
          result: { results: [{ result: { data: { operation: envelope.type } } }] },
        },
      ],
    },
  });
}

beforeEach(() => {
  callKernelMock.mockReset();
  callKernelMock.mockImplementation(async (_env, envelope) => kernelSuccess(envelope));
});

describe('Worker routes', () => {
  it('reports the live Worker configuration at GET /', async () => {
    const response = await app.request('/', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'Portal‑OS live',
      worker: 'planetary-max',
      mode: 'single',
      umbrella: 'strict',
    });
  });

  it('reports health at GET /health', async () => {
    const response = await app.request('/health', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'portal-os-worker' });
  });

  it('rejects an unauthenticated kernel message', async () => {
    const response = await app.request(
      '/api/kernel/message',
      { method: 'POST', body: JSON.stringify({ type: 'universe.state' }) },
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(callKernelMock).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON in a kernel message', async () => {
    const response = await app.request(
      '/api/kernel/message',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer operator', 'Content-Type': 'application/json' },
        body: '{',
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
    expect(callKernelMock).not.toHaveBeenCalled();
  });

  it('passes a stable envelope through callKernel', async () => {
    const response = await app.request(
      '/api/kernel/message',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer operator', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'universe.state',
          payload: { scope: 'all' },
          governanceContext: { tenant: 'portal' },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, type: 'universe.state' });
    expect(callKernelMock).toHaveBeenCalledOnce();
    expect(callKernelMock.mock.calls[0][1]).toMatchObject({
      id: expect.any(String),
      type: 'universe.state',
      payload: { scope: 'all' },
      identity: 'operator',
      governanceContext: { tenant: 'portal' },
    });
  });

  it.each([
    ['/umbrella/identity/license', 'identity.physics.license'],
    ['/umbrella/governance/license', 'governance.engine.license'],
    ['/umbrella/apex/advisory', 'apex.alignment.advisory'],
    ['/umbrella/sim/pack', 'umbrella.sim.pack'],
    ['/umbrella/market/forecast', 'umbrella.market.forecast'],
    ['/umbrella/identity/mirror', 'umbrella.identity.mirror'],
    ['/umbrella/crossworld/access', 'umbrella.crossworld.access'],
    ['/umbrella/structural/truth/license', 'structural.truth.license'],
  ])('validates identity and JSON for %s', async (path, operation) => {
    const unauthenticated = await app.request(
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env,
    );
    expect(unauthenticated.status).toBe(401);

    const invalidJson = await app.request(
      path,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer operator', 'Content-Type': 'application/json' },
        body: '{',
      },
      env,
    );
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });

    const valid = await app.request(
      path,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer operator', 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'advice' }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ ok: true, data: { operation } });
  });

  it.each([
    ['GET', '/universe/state', undefined, 'universe.state'],
    ['GET', '/universe/umbrella', undefined, 'universe.umbrella'],
    ['POST', '/universe/tick', { changes: { population: 2 } }, 'universe.tick'],
  ])('normalizes %s %s through the kernel', async (method, path, payload, operation) => {
    const response = await app.request(
      path,
      {
        method,
        headers: { Authorization: 'Bearer operator', 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { operation },
      meta: { type: operation, identity: 'operator', route: ['test-lane'] },
    });
    expect(callKernelMock.mock.calls[0][1].type).toBe(operation);
  });

  it('maps kernel errors to their HTTP status', async () => {
    callKernelMock.mockResolvedValueOnce(
      Response.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Denied' } }),
    );

    const response = await app.request(
      '/universe/state',
      { headers: { Authorization: 'Bearer operator' } },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Denied' },
    });
  });
});
