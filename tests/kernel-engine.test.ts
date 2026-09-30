import { describe, expect, it } from 'vitest';
import { KernelContractError, parseKernelEnvelope } from '../src/contracts';
import { KernelEngine, LANE_REGISTRY } from '../src/kernel-engine';
import { envelope, MemoryStorage } from './worker-fixtures';

describe('kernel contracts', () => {
  it('accepts the shared envelope shape', () => {
    expect(parseKernelEnvelope(envelope())).toEqual(envelope());
  });

  it.each([
    [{ ...envelope(), id: '' }, 'id'],
    [{ ...envelope(), type: '' }, 'type'],
    [{ ...envelope(), payload: [] }, 'payload'],
    [{ ...envelope(), identity: '' }, 'identity'],
    [{ ...envelope(), governanceContext: [] }, 'governanceContext'],
  ])('rejects malformed envelope field %#', (value, field) => {
    expect(() => parseKernelEnvelope(value)).toThrow(field);
  });

  it('publishes the real lane registry', () => {
    expect(LANE_REGISTRY['ecosystem.step']).toEqual(['cognitive', 'orchestration', 'substrate']);
    expect(LANE_REGISTRY['universe.state']).toEqual(['orchestration']);
  });
});

describe('KernelEngine lanes', () => {
  it('dispatches and persists cognitive state', async () => {
    const engine = new KernelEngine(new MemoryStorage());
    const first = await engine.dispatch(envelope({ id: 'sim-1' }));
    const second = await engine.dispatch(envelope({ id: 'sim-2', payload: { observation: 'changed' } }));

    expect(first).toMatchObject({ lanes: ['cognitive'], output: { stateVersion: 1 } });
    expect(second).toMatchObject({ output: { stateVersion: 2, observations: ['stable', 'changed'] } });
  });

  it('returns the default persistent universe state', async () => {
    const result = await new KernelEngine(new MemoryStorage()).dispatch(envelope({ type: 'universe.state' }));
    expect(result.output).toEqual({ started: false, tick: 0, ecosystem: { population: 0, resources: 100 } });
  });

  it('starts and ticks the universe persistently', async () => {
    const engine = new KernelEngine(new MemoryStorage());
    await engine.dispatch(envelope({ id: 'start', type: 'universe.start' }));
    await engine.dispatch(envelope({
      id: 'tick',
      type: 'universe.tick',
      payload: { changes: { population: 2, resources: -5 } },
    }));
    const state = await engine.dispatch(envelope({ id: 'state', type: 'universe.state' }));

    expect(state.output).toEqual({ started: true, tick: 1, ecosystem: { population: 2, resources: 95 } });
  });

  it('reports umbrella state and enforcement mode', async () => {
    const engine = new KernelEngine(new MemoryStorage(), 'single', 'strict');
    const result = await engine.dispatch(envelope({ type: 'universe.umbrella' }));
    expect(result.output).toEqual({
      active: false,
      governance: 'umbrella',
      enforcement: 'strict',
      violations: [],
    });
  });

  it('dispatches governance with identity context', async () => {
    const result = await new KernelEngine(new MemoryStorage()).dispatch(envelope({ type: 'governance' }));
    expect(result.output).toMatchObject({ authorized: true, identity: 'integration-token' });
  });

  it('fails closed when governance denies the envelope', async () => {
    await expect(new KernelEngine(new MemoryStorage()).dispatch(envelope({
      governanceContext: { deny: true },
    }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('writes and reads substrate values', async () => {
    const engine = new KernelEngine(new MemoryStorage());
    await engine.dispatch(envelope({ type: 'substrate', payload: { key: 'planet', value: { stable: true } } }));
    const result = await engine.dispatch(envelope({
      id: 'read',
      type: 'substrate',
      payload: { key: 'planet', operation: 'read' },
    }));
    expect(result.output).toEqual({ key: 'planet', value: { stable: true } });
  });

  it('runs all ecosystem lanes and returns normalized results', async () => {
    const result = await new KernelEngine(new MemoryStorage()).dispatch(envelope({
      type: 'ecosystem.step',
      payload: { universe: { changes: { population: 1 } }, key: 'latest' },
    }));
    expect(result.lanes).toEqual(['cognitive', 'orchestration', 'substrate']);
    expect(result.results).toHaveLength(3);
    expect(result.output).toMatchObject({
      cognitive: { stateVersion: 1 },
      orchestration: { tick: 1 },
      substrate: { stored: true },
    });
  });

  it('bounds TEC execution', async () => {
    const actions = Array.from({ length: 17 }, (_, index) => ({ index }));
    await expect(new KernelEngine(new MemoryStorage()).dispatch(envelope({
      type: 'tec',
      payload: { actions },
    }))).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  it('rejects unsupported message types', async () => {
    await expect(new KernelEngine(new MemoryStorage()).dispatch(envelope({ type: 'unknown' })))
      .rejects.toBeInstanceOf(KernelContractError);
  });
});
