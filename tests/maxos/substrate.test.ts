import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../../src/maxos/state/repositories/memory';
import { createDurableSubstrate, Substrate } from '../../src/maxos/state/substrate';
import type { SIMState } from '../../src/maxos/state/models/state';
import { r2Bucket } from './fixtures';

const initialSIMState: SIMState = { lastEnvelopeId: 'message-1', memory: {}, steps: 1 };

describe('substrate repositories', () => {
  it('implements deterministic CRUD with optimistic version checks', async () => {
    const repository = new InMemoryRepository<SIMState>();
    const created = await repository.create({
      key: 'sim:1',
      version: 1,
      value: initialSIMState,
      appliedTransitions: ['transition-1'],
    });
    expect(await repository.read('sim:1')).toEqual(created);
    await expect(repository.update({ ...created, version: 2 }, 0)).rejects.toThrowError(/version conflict/);
    expect(await repository.update({ ...created, version: 2 }, 1)).toMatchObject({ version: 2 });
    expect(await repository.delete('sim:1')).toBe(true);
    expect(await repository.read('sim:1')).toBeNull();
  });

  it('applies state transitions idempotently and rejects stale transitions', async () => {
    const substrate = new Substrate();
    const transition = {
      id: 'transition-1',
      key: 'sim:1',
      expectedVersion: 0,
      next: initialSIMState,
    };
    const first = await substrate.transitionSIM(transition);
    expect(await substrate.transitionSIM(transition)).toEqual(first);
    await expect(substrate.transitionSIM({ ...transition, id: 'transition-2', expectedVersion: 0 }))
      .rejects.toThrowError(/version conflict/);
  });

  it('uses conditional R2 writes for durable idempotent state', async () => {
    const substrate = createDurableSubstrate(r2Bucket());
    const transition = {
      id: 'durable-transition-1',
      key: 'sim:durable',
      expectedVersion: 0,
      next: initialSIMState,
    };
    const first = await substrate.transitionSIM(transition);
    expect(await substrate.transitionSIM(transition)).toEqual(first);
    expect(await substrate.repositories.sim.delete(first.key)).toBe(true);
    expect(await substrate.repositories.sim.read(first.key)).toBeNull();
    await expect(substrate.repositories.sim.create(first)).resolves.toEqual(first);
  });
});
