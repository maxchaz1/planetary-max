import { describe, expect, it } from 'vitest';
import app, { type Bindings, type KernelService } from '../src/index';
import { bindings, createKernelService, responseJson, TOKEN } from './worker-fixtures';

const authorization = { Authorization: `Bearer ${TOKEN}` };

describe('planetary-max Worker routes', () => {
  it('uses Hono for the root surface', async () => {
    const response = await app.request('/', {}, bindings());
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({ worker: 'planetary-max' });
  });

  it('reports Worker health', async () => {
    const response = await app.request('/health', {}, bindings());
    expect(await responseJson(response)).toEqual({ status: 'ok', service: 'planetary-max' });
  });

  it('requires a bearer identity for kernel messages', async () => {
    const response = await app.request('/api/kernel/message', { method: 'POST', body: '{}' }, bindings());
    expect(response.status).toBe(401);
    expect(await responseJson(response)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects malformed kernel JSON', async () => {
    const response = await app.request('/api/kernel/message', {
      method: 'POST', headers: authorization, body: '{',
    }, bindings());
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({ error: { code: 'INVALID_JSON' } });
  });

  it('rejects missing kernel message types', async () => {
    const response = await app.request('/api/kernel/message', {
      method: 'POST', headers: authorization, body: JSON.stringify({ payload: {} }),
    }, bindings());
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
  });

  it('rejects non-object payloads', async () => {
    const response = await app.request('/api/kernel/message', {
      method: 'POST', headers: authorization, body: JSON.stringify({ type: 'sim', payload: [] }),
    }, bindings());
    expect(response.status).toBe(400);
  });

  it('dispatches kernel messages through the PortalKernel DO', async () => {
    const response = await app.request('/api/kernel/message', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ id: 'route-message', type: 'sim', payload: { observation: 'rain' } }),
    }, bindings());
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      messageId: 'route-message',
      lanes: ['cognitive'],
      output: { stateVersion: 1, observations: ['rain'] },
    });
  });

  it('normalizes universe state for GUI callers', async () => {
    const response = await app.request('/universe/state', { headers: authorization }, bindings());
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      data: { started: false, tick: 0 },
      meta: { route: ['orchestration'] },
    });
  });

  it('persists universe ticks across GUI requests', async () => {
    const env = bindings(createKernelService());
    const tick = await app.request('/universe/tick', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: { population: 3 } }),
    }, env);
    const state = await app.request('/universe/state', { headers: authorization }, env);

    expect(tick.status).toBe(200);
    expect(await responseJson(state)).toMatchObject({ data: { tick: 1, ecosystem: { population: 3 } } });
  });

  it('accepts an empty universe tick body', async () => {
    const response = await app.request('/universe/tick', {
      method: 'POST', headers: authorization,
    }, bindings());
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({ data: { tick: 1 } });
  });

  it('rejects non-object universe tick JSON', async () => {
    const response = await app.request('/universe/tick', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: '[]',
    }, bindings());
    expect(response.status).toBe(400);
  });

  it('requires identity for Umbrella operations', async () => {
    const response = await app.request('/umbrella/sim/pack', {
      method: 'POST', body: '{}',
    }, bindings());
    expect(response.status).toBe(401);
  });

  it('dispatches Umbrella operations through governance', async () => {
    const response = await app.request('/umbrella/sim/pack', {
      method: 'POST', headers: authorization, body: JSON.stringify({ pack: 'stable' }),
    }, bindings());
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toMatchObject({
      data: { authorized: true, operation: 'umbrella.sim.pack' },
    });
  });

  it('returns a normalized bridge error when no kernel binding is available', async () => {
    const env = { PLANETARY_MODE: 'single', UMBRELLA_ENFORCEMENT: 'strict' } as Bindings;
    const response = await app.request('/universe/state', { headers: authorization }, env);
    expect(response.status).toBe(503);
    expect(await responseJson(response)).toMatchObject({ error: { code: 'KERNEL_UNAVAILABLE' } });
  });

  it('forwards os.* envelopes to MAX-OS-1 when configured', async () => {
    let forwarded: Record<string, unknown> | undefined;
    const maxOs: KernelService = {
      async fetch(request) {
        forwarded = await request.json<Record<string, unknown>>();
        return Response.json({
          ok: true,
          messageId: 'os-message',
          type: 'identity',
          lanes: ['identity'],
          results: [],
          output: { accepted: true },
        });
      },
    };
    const env = { ...bindings(), MAX_OS_1: maxOs };
    const response = await app.request('/api/kernel/message', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ id: 'os-message', type: 'os.identity', payload: {} }),
    }, env);

    expect(response.status).toBe(200);
    expect(forwarded).toMatchObject({
      id: 'os-message',
      type: 'identity',
      identity: { id: 'planetary-max', roles: ['kernel-caller'] },
    });
  });

  it('exposes an authenticated MAX-OS-1 bridge route', async () => {
    let authorizationHeader: string | null = null;
    const maxOs: KernelService = {
      async fetch(request) {
        authorizationHeader = request.headers.get('Authorization');
        return Response.json({
          ok: true,
          messageId: 'direct-os-message',
          type: 'identity',
          lanes: ['identity'],
          results: [],
          output: { accepted: true },
        });
      },
    };
    const response = await app.request('/os/kernel/message', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ id: 'direct-os-message', type: 'identity', payload: {} }),
    }, { ...bindings(), MAX_OS_1: maxOs });

    expect(response.status).toBe(200);
    expect(authorizationHeader).toBe(`Bearer ${TOKEN}`);
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      data: { messageId: 'direct-os-message', lanes: ['identity'] },
      meta: { source: 'max-os-1' },
    });
  });

  it('fails closed when the MAX-OS-1 bridge is not configured', async () => {
    const response = await app.request('/os/kernel/message', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ type: 'identity', payload: {} }),
    }, bindings());

    expect(response.status).toBe(503);
    expect(await responseJson(response)).toMatchObject({
      ok: false,
      meta: { source: 'max-os-1', status: 503 },
    });
  });
});
