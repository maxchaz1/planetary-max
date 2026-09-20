import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createEnforcementMiddleware, enforceEnvelope } from '../../src/maxos/middleware/enforcement';
import type { MaxOsHonoEnv } from '../../src/maxos/types';
import { bindings, envelope } from './fixtures';

describe('enforcement middleware', () => {
  it('attaches identity and governance metadata before the next handler', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.json(context.get('maxosEnvelope').metadata.enforcement));

    const response = await app.request('/', { method: 'POST', body: JSON.stringify(envelope()) }, bindings());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      identity: { identityId: 'identity-1', structurallyValidated: true },
      governance: { validated: true },
    });
  });

  it('blocks invalid identity and governance before orchestration', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.text('orchestrated'));
    const invalidIdentity = envelope({ identity: { ...envelope().identity, authenticated: false } });
    const response = await app.request('/', { method: 'POST', body: JSON.stringify(invalidIdentity) }, bindings());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'IDENTITY_INVALID' } });
  });

  it('reports malformed JSON as an invalid envelope', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.text('orchestrated'));
    const response = await app.request('/', { method: 'POST', body: '{' }, bindings());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_ENVELOPE' } });
  });

  it('rejects missing identity and governance structures at the parsing boundary', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.text('orchestrated'));
    const { identity: _identity, ...missingIdentity } = envelope();
    const response = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(missingIdentity),
    }, bindings());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_ENVELOPE' } });
  });

  it('rejects an empty session id instead of silently dropping it', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.text('orchestrated'));
    const response = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(envelope({ sessionId: '   ' })),
    }, bindings());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_ENVELOPE' } });
  });

  it('rejects malformed optional lane payloads instead of silently dropping them', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', (context) => context.text('orchestrated'));
    const response = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...envelope(), sim: 'invalid' }),
    }, bindings());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_ENVELOPE' } });
  });

  it('enforces runtime modes in the pure middleware boundary', () => {
    expect(() => enforceEnvelope(envelope(), {
      PLANETARY_MODE: 'inactive',
      UMBRELLA_ENFORCEMENT: 'enabled',
    })).toThrowError(/PLANETARY_MODE/);
  });

  it('does not normalize downstream failures as enforcement denials', async () => {
    const app = new Hono<MaxOsHonoEnv>();
    app.use('*', createEnforcementMiddleware());
    app.post('*', () => { throw new Error('downstream failure'); });
    app.onError((_error, context) => context.json({ source: 'downstream' }, 500));

    const response = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(envelope()),
    }, bindings());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ source: 'downstream' });
  });
});
