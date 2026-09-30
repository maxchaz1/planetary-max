import { describe, expect, it } from 'vitest';
import { enforceEnvelope } from '../../src/maxos/middleware/enforcement';
import { SessionOrchestrator } from '../../src/maxos/session/orchestrator';
import type { SessionState, StateModel } from '../../src/maxos/state/models/state';
import type { SIMState } from '../../src/maxos/state/models/state';
import { InMemoryRepository } from '../../src/maxos/state/repositories/memory';
import type { Repository } from '../../src/maxos/state/repositories/repository';
import { Substrate } from '../../src/maxos/state/substrate';
import { envelope } from './fixtures';

const modes = { PLANETARY_MODE: 'active', UMBRELLA_ENFORCEMENT: 'enabled' };

class CompletionFailingRepository implements Repository<SessionState> {
  readonly consistency = 'strong' as const;
  private readonly delegate = new InMemoryRepository<SessionState>();
  private failCompletion = true;

  create(model: StateModel<SessionState>): Promise<StateModel<SessionState>> {
    return this.delegate.create(model);
  }

  read(key: string): Promise<StateModel<SessionState> | null> {
    return this.delegate.read(key);
  }

  update(model: StateModel<SessionState>, expectedVersion: number): Promise<StateModel<SessionState>> {
    if (this.failCompletion && model.appliedTransitions.some((id) => id.startsWith('session:route:'))) {
      this.failCompletion = false;
      throw new Error('completion unavailable');
    }
    return this.delegate.update(model, expectedVersion);
  }

  delete(key: string): Promise<boolean> {
    return this.delegate.delete(key);
  }
}

class ReleaseFailingRepository extends InMemoryRepository<SessionState> {
  override update(model: StateModel<SessionState>, expectedVersion: number): Promise<StateModel<SessionState>> {
    if (model.appliedTransitions.some((id) => id.startsWith('session:release:'))) {
      throw new Error('release unavailable');
    }
    return super.update(model, expectedVersion);
  }
}

class LeaseExpiringSIMRepository extends InMemoryRepository<SIMState> {
  constructor(private readonly expire: () => void) {
    super();
  }

  override read(key: string): Promise<StateModel<SIMState> | null> {
    this.expire();
    return super.read(key);
  }
}

describe('session orchestrator', () => {
  it('creates and resumes deterministic sessions', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const enforced = enforceEnvelope(envelope(), modes);
    const created = await orchestrator.createSession(enforced);
    expect(created.value.sessionId).toMatch(/^session_[0-9a-f]{64}$/);
    expect(await orchestrator.createSession(enforced)).toEqual(created);
    expect(await orchestrator.resumeSession(created.value.sessionId)).toEqual(created);
  });

  it('validates, routes, and returns a deterministic orchestration envelope', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const enforced = enforceEnvelope(envelope({ id: 'orchestration-1' }), modes);
    const first = await orchestrator.routeEnvelope(enforced, modes);
    expect(first).toMatchObject({
      id: 'orchestration-1',
      laneOutput: { lane: 'sim' },
      metadata: { route: { entryId: 'sim-lane', lane: 'sim' } },
    });
    expect(orchestrator.normalizeKernelResponse({ ok: true, result: { b: 2, a: 1 } }, first, 200))
      .toEqual({
        ok: true,
        messageId: 'orchestration-1',
        status: 200,
        data: { ok: true, result: { a: 1, b: 2 } },
      });
    expect(orchestrator.normalizeKernelResponse({ redirected: true }, first, 302).ok).toBe(false);
  });

  it('validates governance again before routing', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const enforced = enforceEnvelope(envelope(), modes);
    const invalid = {
      ...enforced,
      governanceContext: { ...enforced.governanceContext, deny: true },
    };
    await expect(orchestrator.routeEnvelope(invalid, modes)).rejects.toThrowError(/invalid governance/);
  });

  it('rejects attempts to resume another identity\'s session', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const owner = enforceEnvelope(envelope({ id: 'owner-message' }), modes);
    const session = await orchestrator.createSession(owner);
    const intruder = enforceEnvelope(envelope({
      id: 'intruder-message',
      sessionId: session.value.sessionId,
      identity: {
        ...envelope().identity,
        credential: 'intruder-token',
        id: 'identity-2',
      },
    }), modes);
    await expect(orchestrator.routeEnvelope(intruder, modes)).rejects.toThrowError(/does not match/);
  });

  it('reserves a session before lane mutation under concurrent requests', async () => {
    const substrate = new Substrate();
    const orchestrator = new SessionOrchestrator(substrate);
    const owner = enforceEnvelope(envelope({ id: 'session-owner' }), modes);
    const session = await orchestrator.createSession(owner);
    const first = enforceEnvelope(envelope({ id: 'concurrent-1', sessionId: session.value.sessionId }), modes);
    const second = enforceEnvelope(envelope({ id: 'concurrent-2', sessionId: session.value.sessionId }), modes);
    const results = await Promise.allSettled([
      orchestrator.routeEnvelope(first, modes),
      orchestrator.routeEnvelope(second, modes),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const simState = await substrate.repositories.sim.read(`sim:${session.value.sessionId}`);
    expect(simState?.value.steps).toBe(1);
  });

  it('normalizes malformed kernel failures as failures', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const routed = await orchestrator.routeEnvelope(
      enforceEnvelope(envelope({ id: 'kernel-failure' }), modes),
      modes,
    );
    expect(orchestrator.normalizeKernelResponse({ ok: false }, routed, 500)).toEqual({
      ok: false,
      messageId: 'kernel-failure',
      status: 500,
      error: { code: 'KERNEL_ERROR', message: 'Kernel request failed' },
    });
  });

  it('rejects replay of an envelope that already completed', async () => {
    const orchestrator = new SessionOrchestrator(new Substrate());
    const enforced = enforceEnvelope(envelope({ id: 'completed-envelope' }), modes);
    await orchestrator.routeEnvelope(enforced, modes);
    await expect(orchestrator.routeEnvelope(enforced, modes)).rejects.toThrowError(/already completed/);
  });

  it('allows an expired session reservation to be reclaimed', async () => {
    let now = 1_000;
    const substrate = new Substrate();
    const orchestrator = new SessionOrchestrator(substrate, () => now, 100);
    const owner = enforceEnvelope(envelope({ id: 'lease-owner' }), modes);
    const session = await orchestrator.createSession(owner);
    await substrate.transitionSession({
      id: 'abandoned-reservation',
      key: session.key,
      expectedVersion: session.version,
      next: {
        ...session.value,
        reservation: 'abandoned-envelope',
        reservationExpiresAt: 1_050,
      },
    });
    now = 1_100;
    const reclaimed = enforceEnvelope(envelope({
      id: 'reclaimed-envelope',
      sessionId: session.value.sessionId,
    }), modes);
    await expect(orchestrator.routeEnvelope(reclaimed, modes)).resolves.toMatchObject({
      id: 'reclaimed-envelope',
      laneOutput: { lane: 'sim' },
    });
  });

  it('releases each reservation when the same envelope repeatedly fails routing', async () => {
    const substrate = new Substrate();
    const orchestrator = new SessionOrchestrator(substrate);
    const owner = enforceEnvelope(envelope({ id: 'release-owner' }), modes);
    const session = await orchestrator.createSession(owner);
    const unroutable = enforceEnvelope(envelope({
      id: 'repeated-failure',
      sessionId: session.value.sessionId,
      type: 'unknown',
    }), modes);

    await expect(orchestrator.routeEnvelope(unroutable, modes)).rejects.toThrowError(/No MAX-OS-1 route/);
    await expect(orchestrator.routeEnvelope(unroutable, modes)).rejects.toThrowError(/No MAX-OS-1 route/);
    const released = await substrate.readSession(session.key);
    expect(released?.value.reservation).toBeUndefined();
  });

  it('rejects a concurrent caller carrying the active reservation envelope id', async () => {
    const substrate = new Substrate();
    const orchestrator = new SessionOrchestrator(substrate);
    const owner = enforceEnvelope(envelope({ id: 'same-envelope-owner' }), modes);
    const session = await orchestrator.createSession(owner);
    await substrate.transitionSession({
      id: 'held-reservation',
      key: session.key,
      expectedVersion: session.version,
      next: {
        ...session.value,
        reservation: 'same-envelope',
        reservationExpiresAt: Date.now() + 30_000,
      },
    });
    const concurrent = enforceEnvelope(envelope({
      id: 'same-envelope',
      sessionId: session.value.sessionId,
    }), modes);
    await expect(orchestrator.routeEnvelope(concurrent, modes)).rejects.toThrowError(/processing another request/);
  });

  it('grants only one owner when the same envelope races for a reservation', async () => {
    const substrate = new Substrate();
    const orchestrator = new SessionOrchestrator(substrate);
    const owner = enforceEnvelope(envelope({ id: 'same-race-owner' }), modes);
    const session = await orchestrator.createSession(owner);
    const concurrent = enforceEnvelope(envelope({
      id: 'same-race-envelope',
      sessionId: session.value.sessionId,
    }), modes);

    const results = await Promise.allSettled([
      orchestrator.routeEnvelope(concurrent, modes),
      orchestrator.routeEnvelope(concurrent, modes),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('releases its reservation when session completion fails', async () => {
    const sessions = new CompletionFailingRepository();
    const substrate = new Substrate({ sessions });
    const orchestrator = new SessionOrchestrator(substrate);
    const enforced = enforceEnvelope(envelope({ id: 'completion-failure' }), modes);

    await expect(orchestrator.routeEnvelope(enforced, modes)).rejects.toThrowError(/Substrate operation/);
    const sessionId = (await orchestrator.createSession(enforced)).value.sessionId;
    const released = await substrate.readSession(`session:${sessionId}`);
    expect(released?.value.reservation).toBeUndefined();
  });

  it('preserves a routing error when reservation cleanup also fails', async () => {
    const substrate = new Substrate({ sessions: new ReleaseFailingRepository() });
    const orchestrator = new SessionOrchestrator(substrate);
    const unroutable = enforceEnvelope(envelope({ id: 'route-and-release-failure', type: 'unknown' }), modes);

    await expect(orchestrator.routeEnvelope(unroutable, modes)).rejects.toThrowError(/No MAX-OS-1 route/);
  });

  it('fences lane commits after the session reservation expires', async () => {
    let now = 1_000;
    const sim = new LeaseExpiringSIMRepository(() => { now = 1_101; });
    const substrate = new Substrate({ sim });
    const orchestrator = new SessionOrchestrator(substrate, () => now, 100);
    const enforced = enforceEnvelope(envelope({ id: 'expired-during-routing' }), modes);
    const session = await orchestrator.createSession(enforced);

    await expect(orchestrator.routeEnvelope(enforced, modes)).rejects.toThrowError(/reservation expired/);
    expect(await sim.read(`sim:${session.value.sessionId}`)).toBeNull();
  });
});
