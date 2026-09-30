import { describe, expect, it, vi } from 'vitest';
import { PortalKernel } from '../src/do/PortalKernel';
import {
  app,
  createEnvelope,
  extractLaneData,
  readKernelResult,
  resolveUmbrellaMode,
  type Bindings,
  type KernelEnvelope,
  type KernelLane,
} from '../src/index';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpc3MiOiJwb3J0YWwtbG9naW4iLCJhdWQiOiJwbGFuZXRhcnktbWF4IiwiZXhwIjo0MTAyNDQ0ODAwfQ.MWNP0Fu3Ky8BUTACh5fSViDpRZL2SkN5moFjz[...]
const IDENTITY_JWT_SECRET = 'unit-test-signing-secret';

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function makeKernel(mode = 'strict'): PortalKernel {
  return new PortalKernel(
    { storage: new MemoryStorage() } as unknown as DurableObjectState,
    { UMBRELLA_ENFORCEMENT: mode },
  );
}

function makeBindings(options: {
  mode?: string;
  kernel?: PortalKernel;
  maxOsFetch?: (request: Request) => Promise<Response>;
} = {}): Bindings {
  const kernel = options.kernel ?? makeKernel(options.mode);
  return {
    PLANETARY_MODE: 'single',
    UMBRELLA_ENFORCEMENT: options.mode ?? 'strict',
    IDENTITY_JWT_SECRET,
    IDENTITY_JWT_ISSUER: 'portal-login',
    IDENTITY_JWT_AUDIENCE: 'planetary-max',
    PORTAL_KERNEL: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({ fetch: (request) => kernel.fetch(request) }),
    },
    MAX_OS_1: {
      fetch:
        options.maxOsFetch ??
        (async () =>
          Response.json({
            lanes: [
              {
                name: 'umbrella.os',
                result: {
                  results: [
                    {
                      result: {
                        data: {
                          osPermissions: {},
                          osIdentity: {},
                          osGovernanceFlags: {},
                          osTruthInvariants: {},
                        },
                        meta: { source: 'MAX-OS-1', governance: 'strict' },
                      },
                    },
                  ],
                },
              },
            ],
            meta: { umbrella: 'os-update' },
          })),
    },
  };
}

function authorized(method = 'GET', body?: unknown): RequestInit {
  return {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function envelope(
  type: string,
  payload: Record<string, unknown> = {},
  governanceContext: Record<string, unknown> = {},
): KernelEnvelope {
  return {
    id: `message-${type}`,
    type,
    payload,
    identity: TOKEN,
    governanceContext: { ...governanceContext, umbrellaMode: 'strict' },
  };
}

async function kernelRequest(kernel: PortalKernel, value: unknown, raw = false): Promise<Response> {
  return kernel.fetch(
    new Request('https://kernel.test/api/kernel/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? String(value) : JSON.stringify(value),
    }),
  );
}

describe('kernel result helpers', () => {
  it('resolves all supported umbrella modes', () => {
    expect(['strict', 'advisory', 'off'].map(resolveUmbrellaMode)).toEqual(['strict', 'advisory', 'off']);
  });

  it('fails closed for an unknown umbrella mode', () => {
    expect(resolveUmbrellaMode('enabled')).toBe('strict');
  });

  it('injects configured governance without allowing a caller override', () => {
    const value = createEnvelope('sim.step', {}, TOKEN, { tenant: 'one', umbrellaMode: 'off' }, 'strict');
    expect(value.governanceContext).toMatchObject({ tenant: 'one', umbrellaMode: 'strict' });
  });

  it('extracts normalized lane data', () => {
    const lanes = [
      {
        name: 'umbrella.os',
        result: { results: [{ result: { data: { allowed: true }, meta: { source: 'test', governance: 'strict' } } }] },
      },
    ] as KernelLane[];
    expect(extractLaneData(lanes)).toEqual({ allowed: true });
  });
});

describe('Hono Worker routes', () => {
  it('reports deployment health', async () => {
    const response = await app.request('/health', undefined, makeBindings());
    expect(await response.json()).toEqual({ status: 'ok', service: 'planetary-max', umbrella: 'strict' });
  });

  it('rejects a kernel request with a missing or invalid bearer token', async () => {
    const missing = await app.request('/api/kernel/message', { method: 'POST' }, makeBindings());
    const invalid = await app.request(
      '/api/kernel/message',
      authorized('POST', { type: 'sim.step', payload: {} }),
      { ...makeBindings(), IDENTITY_JWT_SECRET: 'different-signing-secret' },
    );
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it('rejects malformed JSON', async () => {
    const response = await app.request(
      '/api/kernel/message',
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{' },
      makeBindings(),
    );
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
  });

  it('rejects a non-object payload', async () => {
    const response = await app.request(
      '/api/kernel/message',
      authorized('POST', { type: 'sim.step', payload: [] }),
      makeBindings(),
    );
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  });

  it('returns a normalized kernel result', async () => {
    const response = await app.request(
      '/api/kernel/message',
      authorized('POST', { type: 'sim.step', payload: { value: 1 } }),
      makeBindings(),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { kernel: 'Portal-OS Kernel Engine', operation: 'sim.step', accepted: true },
      meta: { type: 'sim.step', identity: { propagated: true } },
    });
  });

  it('never returns the bearer token', async () => {
    const response = await app.request(
      '/api/kernel/message',
      authorized('POST', { type: 'sim.step', payload: {} }),
      makeBindings(),
    );
    expect(await response.text()).not.toContain(TOKEN);
  });

  it('returns DO-backed universe state', async () => {
    const response = await app.request('/universe/state', authorized(), makeBindings());
    expect(await response.json()).toMatchObject({ ok: true, data: { tick: 0, properties: {} } });
  });

  it('ticks the universe with an empty body', async () => {
    const response = await app.request('/universe/tick', authorized('POST'), makeBindings());
    expect(await response.json()).toMatchObject({ ok: true, data: { tick: 1 } });
  });

  it('applies deterministic universe changes', async () => {
    const bindings = makeBindings();
    const first = await app.request('/universe/tick', authorized('POST', { changes: { resources: 2 } }), bindings);
    const second = await app.request('/universe/tick', authorized('POST', { changes: { resources: 3 } }), bindings);
    expect(await first.json()).toMatchObject({ data: { tick: 1, properties: { resources: 2 } } });
    expect(await second.json()).toMatchObject({ data: { tick: 2, properties: { resources: 5 } } });
  });

  it('returns umbrella state', async () => {
    const response = await app.request('/universe/umbrella', authorized(), makeBindings());
    expect(await response.json()).toMatchObject({
      data: { umbrellaMode: 'strict', osTruthInvariants: { structuralTruth: true } },
    });
  });

  it('routes identity physics through an umbrella lane', async () => {
    const response = await app.request('/umbrella/identity/license', authorized('POST', {}), makeBindings());
    expect(await response.json()).toMatchObject({
      lanes: [{ name: 'umbrella.identity-physics' }],
      data: { osIdentity: { authenticated: true, physicsApplied: true } },
    });
  });

  it('enforces structural truth', async () => {
    const response = await app.request(
      '/umbrella/structural/truth/license',
      authorized('POST', { structuralTruth: false }),
      makeBindings(),
    );
    expect(response.status).toBe(403);
  });

  it('answers CORS preflight requests', async () => {
    const response = await app.request(
      '/api/kernel/message',
      { method: 'OPTIONS', headers: { Origin: 'https://portal.example' } },
      makeBindings(),
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns a sanitized gateway error for an invalid kernel response', async () => {
    const bindings = makeBindings();
    bindings.PORTAL_KERNEL.get = () => ({ fetch: async () => new Response(`invalid-${TOKEN}`) });
    const response = await app.request('/universe/state', authorized(), bindings);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(TOKEN);
  });

  it('protects the MAX-OS-1 bridge with authentication', async () => {
    const response = await app.request('/os/kernel/message', { method: 'POST' }, makeBindings());
    expect(response.status).toBe(401);
  });

  it('does not call MAX-OS-1 when DO governance denies the request', async () => {
    const maxOsFetch = vi.fn(async () => Response.json({ ok: true }));
    const response = await app.request(
      '/os/kernel/message',
      authorized('POST', {
        type: 'identity.physics',
        payload: {},
        governanceContext: { permissions: { 'identity.physics': false } },
      }),
      makeBindings({ maxOsFetch }),
    );
    expect(response.status).toBe(403);
    expect(maxOsFetch).not.toHaveBeenCalled();
  });

  it('normalizes MAX-OS-1 umbrella results', async () => {
    const response = await app.request(
      '/os/kernel/message',
      authorized('POST', { type: 'identity.physics', payload: {} }),
      makeBindings(),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      lanes: [{ name: 'umbrella.os', result: { results: [{ result: { meta: { source: 'MAX-OS-1' } } }] } }],
      meta: { umbrella: 'os-update', identity: { propagated: true } },
    });
  });

  it('preserves identity and governance context across the MAX-OS-1 bridge', async () => {
    let forwarded: KernelEnvelope | undefined;
    const response = await app.request(
      '/os/kernel/message',
      authorized('POST', { type: 'governance.inspect', payload: {}, governanceContext: { tenant: 'earth' } }),
      makeBindings({
        maxOsFetch: async (request) => {
          forwarded = await request.json<KernelEnvelope>();
          return Response.json({ data: { accepted: true }, meta: { umbrella: 'os-update' } });
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(forwarded).toMatchObject({ identity: TOKEN, governanceContext: { tenant: 'earth', umbrellaMode: 'strict' } });
  });
});

describe('PortalKernel Durable Object', () => {
  it('reports DO health for non-message routes', async () => {
    const response = await makeKernel().fetch(new Request('https://kernel.test/health'));
    expect(await response.json()).toEqual({ status: 'ok', service: 'portal-kernel' });
  });

  it('rejects invalid JSON envelopes', async () => {
    const response = await kernelRequest(makeKernel(), '{', true);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
  });

  it('rejects incomplete envelopes', async () => {
    const response = await kernelRequest(makeKernel(), { type: 'sim.step' });
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  });

  it('dispatches a general kernel operation', async () => {
    const response = await kernelRequest(makeKernel(), envelope('sim.step'));
    expect(await response.json()).toMatchObject({
      ok: true,
      lanes: [{ name: 'kernel' }],
      data: { operation: 'sim.step', accepted: true },
    });
  });

  it('returns an initial universe state without mutating storage', async () => {
    const response = await kernelRequest(makeKernel(), envelope('universe.state'));
    expect(await response.json()).toMatchObject({ data: { tick: 0, properties: {}, lastOperation: null } });
  });

  it('sorts and persists deterministic tick changes', async () => {
    const kernel = makeKernel();
    const tick = await kernelRequest(kernel, envelope('universe.tick', { changes: { zeta: 1, alpha: 2 } }));
    const state = await kernelRequest(kernel, envelope('universe.state'));
    expect(await tick.json()).toMatchObject({ data: { tick: 1, properties: { alpha: 2, zeta: 1 } } });
    expect(await state.json()).toMatchObject({ data: { tick: 1, properties: { alpha: 2, zeta: 1 } } });
  });

  it('adds numeric deltas on successive ticks', async () => {
    const kernel = makeKernel();
    await kernelRequest(kernel, envelope('universe.tick', { changes: { population: 5 } }));
    const response = await kernelRequest(kernel, envelope('universe.tick', { changes: { population: -2 } }));
    expect(await response.json()).toMatchObject({ data: { tick: 2, properties: { population: 3 } } });
  });

  it('denies governance violations in strict mode', async () => {
    const response = await kernelRequest(makeKernel('strict'), envelope('sim.step', {}, { deny: true }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ meta: { governance: { mode: 'strict', decision: 'denied' } } });
  });

  it('returns governance deltas in advisory mode', async () => {
    const value = envelope('sim.step', { structuralTruth: false }, { deny: true });
    value.governanceContext.umbrellaMode = 'advisory';
    const response = await kernelRequest(makeKernel('advisory'), value);
    const result = await response.json<{ meta: { governance: { decision: string; deltas: unknown[] } } }>();
    expect(result.meta.governance.decision).toBe('advisory');
    expect(result.meta.governance.deltas).toHaveLength(2);
  });

  it('bypasses governance rules in off mode', async () => {
    const value = envelope('sim.step', { structuralTruth: false }, { deny: true });
    value.governanceContext.umbrellaMode = 'off';
    const response = await kernelRequest(makeKernel('off'), value);
    expect(await response.json()).toMatchObject({ ok: true, meta: { governance: { mode: 'off', decision: 'bypassed' } } });
  });

  it('enforces lane access policy', async () => {
    const response = await kernelRequest(
      makeKernel('strict'),
      envelope('identity.physics.license', {}, { allowedLanes: ['universe'] }),
    );
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('emits the required umbrella OS lane shape', async () => {
    const value = envelope('umbrella.os', { permissions: { deploy: true } });
    const raw = await kernelRequest(makeKernel(), value);
    const result = await readKernelResult(raw, value, 'PortalKernel');
    expect(result).toMatchObject({
      ok: true,
      lanes: [
        {
          name: 'umbrella.os',
          result: {
            results: [
              {
                result: {
                  data: {
                    osPermissions: { deploy: true },
                    osIdentity: {},
                    osGovernanceFlags: {},
                    osTruthInvariants: {},
                  },
                  meta: { source: 'PortalKernel', governance: 'strict' },
                },
              },
            ],
          },
        },
      ],
      meta: { umbrella: 'os-update' },
    });
  });
});
