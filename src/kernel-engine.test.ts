import { describe, expect, it } from 'vitest';

import type { KernelEnvelope } from './contracts';
import { KernelEngine, type LaneExecutionContext } from './kernel-engine';

function envelope(type: string, payload: Record<string, unknown> = {}): KernelEnvelope {
  return {
    id: `message-${type}`,
    type,
    payload,
    identity: 'operator',
    governanceContext: {},
  };
}

function engine(governanceContext: Record<string, unknown> = {}): KernelEngine {
  const values = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
    put: async (key: string, value: unknown): Promise<void> => {
      values.set(key, structuredClone(value));
    },
  } as unknown as DurableObjectStorage;
  const context: LaneExecutionContext = {
    identity: 'operator',
    governanceContext,
    planetaryMode: 'single',
    umbrellaEnforcement: 'strict',
    storage,
  };
  return new KernelEngine(context);
}

describe('KernelEngine', () => {
  it('aggregates lane data in the stable KernelResult shape', async () => {
    const result = await engine().dispatch(envelope('identity.physics.license', { level: 'full' }));

    expect(result).toMatchObject({
      ok: true,
      messageId: 'message-identity.physics.license',
      type: 'identity.physics.license',
      identity: 'operator',
      route: ['identity-physics'],
      result: {
        lanes: [
          {
            lane: 'identity-physics',
            result: { results: [{ result: { data: { licensed: true, mode: 'single' } } }] },
          },
        ],
      },
    });
  });

  it('persists universe ticks across dispatches', async () => {
    const kernel = engine();

    const tick = await kernel.dispatch(
      envelope('universe.tick', { changes: { population: 2, climate: 'stable' } }),
    );
    const state = await kernel.dispatch(envelope('universe.state'));

    expect(tick.result?.lanes?.[0].result.results[0].result.data).toMatchObject({
      started: true,
      tick: 1,
      ecosystem: { population: 2, resources: 100, climate: 'stable' },
    });
    expect(state.result?.lanes?.[0].result.results[0].result.data).toMatchObject({
      started: true,
      tick: 1,
    });
  });

  it('rejects unsupported message types', async () => {
    const result = await engine().dispatch(envelope('unknown.operation'));

    expect(result).toEqual({
      ok: false,
      messageId: 'message-unknown.operation',
      error: { code: 'INVALID_MESSAGE', message: 'Unsupported message type: unknown.operation' },
    });
  });

  it('enforces governance denial before any lane executes', async () => {
    const result = await engine({ deny: true }).dispatch(envelope('universe.tick'));

    expect(result).toEqual({
      ok: false,
      messageId: 'message-universe.tick',
      error: { code: 'FORBIDDEN', message: 'Governance context denied this operation' },
    });
  });
});
