import { MaxOsError } from '../errors';
import { attachGovernanceMetadata, validateGovernanceContext } from '../governance/lane';
import { attachIdentityMetadata, validateIdentityEnvelope } from '../identity/lane';
import { MaxOsRouter } from '../routing/router';
import type { RoutedLaneOutput } from '../routing/types';
import { deterministicId, isJsonObject, isJsonValue, stableClone } from '../stable';
import type { SessionState, StateModel } from '../state/models/state';
import type { Substrate } from '../state/substrate';
import type {
  EnforcedEnvelope,
  Envelope,
  MaxOsBindings,
  NormalizedKernelResponse,
  OrchestratedEnvelope,
} from '../types';

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export class SessionOrchestrator {
  private readonly router: MaxOsRouter;

  constructor(
    private readonly substrate: Substrate,
    private readonly now: () => number = Date.now,
    private readonly reservationTtlMs = 30_000,
  ) {
    this.router = new MaxOsRouter(substrate);
  }

  async createSession(envelope: EnforcedEnvelope): Promise<StateModel<SessionState>> {
    const sessionId = envelope.sessionId ?? await deterministicId('session', {
      envelopeId: envelope.id,
      identityId: envelope.identity.id,
    });
    const key = sessionKey(sessionId);
    const current = await this.substrate.readSession(key);
    if (current !== null) return current;
    return this.substrate.transitionSession({
      id: `session:create:${envelope.id}`,
      key,
      expectedVersion: 0,
      next: {
        envelopeId: envelope.id,
        identityId: envelope.identity.id,
        sessionId,
      },
    });
  }

  async resumeSession(sessionId: string): Promise<StateModel<SessionState>> {
    const session = await this.substrate.readSession(sessionKey(sessionId));
    if (session === null) throw new MaxOsError('SESSION_NOT_FOUND', `Session ${sessionId} was not found`, 404);
    return session;
  }

  private async reserveSession(
    session: StateModel<SessionState>,
    envelope: EnforcedEnvelope,
  ): Promise<StateModel<SessionState>> {
    if (session.appliedTransitions.includes(`session:route:${envelope.id}`)) {
      throw new MaxOsError('STATE_CONFLICT', `Envelope ${envelope.id} has already completed`, 409);
    }
    const now = this.now();
    const reservationActive = session.value.reservation !== undefined
      && (session.value.reservationExpiresAt ?? Number.POSITIVE_INFINITY) > now;
    if (reservationActive) {
      throw new MaxOsError('STATE_CONFLICT', `Session ${session.value.sessionId} is processing another request`, 409);
    }
    const reservationToken = crypto.randomUUID();
    const reserved = await this.substrate.transitionSession({
      id: `session:reserve:${envelope.id}:${reservationToken}`,
      key: session.key,
      expectedVersion: session.version,
      next: {
        ...session.value,
        reservation: envelope.id,
        reservationExpiresAt: now + this.reservationTtlMs,
        reservationToken,
      },
    });
    if (reserved.value.reservationToken !== reservationToken) {
      throw new MaxOsError('STATE_CONFLICT', `Session ${session.value.sessionId} reservation was not acquired`, 409);
    }
    return reserved;
  }

  private async releaseSessionReservation(
    session: StateModel<SessionState>,
    envelopeId: string,
  ): Promise<void> {
    const {
      reservation: _reservation,
      reservationExpiresAt: _reservationExpiresAt,
      reservationToken: _reservationToken,
      ...released
    } = session.value;
    await this.substrate.transitionSession({
      id: `session:release:${envelopeId}:${session.version}`,
      key: session.key,
      expectedVersion: session.version,
      next: released,
    });
  }

  private async renewSessionReservation(
    session: StateModel<SessionState>,
  ): Promise<StateModel<SessionState>> {
    const current = await this.substrate.readSession(session.key);
    const token = session.value.reservationToken;
    const now = this.now();
    if (
      current === null
      || token === undefined
      || current.value.reservationToken !== token
      || (current.value.reservationExpiresAt ?? 0) <= now
    ) {
      throw new MaxOsError('STATE_CONFLICT', `Session ${session.value.sessionId} reservation expired`, 409);
    }
    return this.substrate.transitionSession({
      id: `session:renew:${token}:${current.version}`,
      key: current.key,
      expectedVersion: current.version,
      next: { ...current.value, reservationExpiresAt: now + this.reservationTtlMs },
    });
  }

  attachIdentity(
    envelope: Envelope,
    bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
  ): EnforcedEnvelope {
    const identity = attachIdentityMetadata(envelope, bindings);
    const governance = attachGovernanceMetadata(envelope);
    return {
      ...envelope,
      metadata: { ...envelope.metadata, enforcement: { identity, governance } },
    };
  }

  attachGovernance(envelope: EnforcedEnvelope): EnforcedEnvelope {
    const governance = attachGovernanceMetadata(envelope);
    return {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        enforcement: { ...envelope.metadata.enforcement, governance },
      },
    };
  }

  async routeEnvelope(
    envelope: EnforcedEnvelope,
    bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
  ): Promise<OrchestratedEnvelope> {
    const span = await this.substrate.observability?.trace.startSpan('orchestrator');
    const stopTimer = this.substrate.observability?.metrics.timer('maxos_orchestrator_latency_ms');
    try {
      const result = await this.orchestrate(envelope, bindings);
      const latencyMs = stopTimer?.();
      this.substrate.observability?.logger.info('orchestrator.completed', {
        lane: result.metadata.route.lane,
        latencyMs,
        sessionId: result.sessionId,
        spanId: span?.spanId,
      });
      return result;
    } catch (error) {
      stopTimer?.();
      this.substrate.observability?.metrics.increment('maxos_failures_total', { stage: 'orchestrator' });
      this.substrate.observability?.logger.error('orchestrator.failed', { spanId: span?.spanId });
      throw error;
    }
  }

  private async orchestrate(
    envelope: EnforcedEnvelope,
    bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
  ): Promise<OrchestratedEnvelope> {
    if (!validateIdentityEnvelope(envelope.identity)) {
      throw new MaxOsError('IDENTITY_INVALID', 'Orchestrator rejected invalid identity', 401);
    }
    if (!validateGovernanceContext(envelope.governanceContext)) {
      throw new MaxOsError('GOVERNANCE_DENIED', 'Orchestrator rejected invalid governance', 403);
    }
    const attached = this.attachGovernance(this.attachIdentity(envelope, bindings));
    const session = envelope.sessionId === undefined
      ? await this.createSession(attached)
      : await this.resumeSession(envelope.sessionId);
    if (session.value.identityId !== attached.identity.id) {
      throw new MaxOsError('IDENTITY_INVALID', 'Session identity does not match the request identity', 403);
    }
    let reserved = await this.reserveSession(session, attached);
    const withSession: EnforcedEnvelope & { sessionId: string } = {
      ...attached,
      sessionId: session.value.sessionId,
    };
    let routed: RoutedLaneOutput;
    try {
      routed = await this.router.routeEnvelope(withSession, async () => {
        reserved = await this.renewSessionReservation(reserved);
      });
    } catch (error) {
      try {
        await this.releaseSessionReservation(reserved, envelope.id);
      } catch {
        // Preserve the routing failure; reservation leases provide bounded recovery.
      }
      throw error;
    }
    const {
      reservation: _reservation,
      reservationExpiresAt: _reservationExpiresAt,
      reservationToken: _reservationToken,
      ...completedSession
    } = reserved.value;
    try {
      await this.substrate.transitionSession({
        id: `session:route:${envelope.id}`,
        key: reserved.key,
        expectedVersion: reserved.version,
        next: { ...completedSession, envelopeId: envelope.id, lane: routed.entry.lane },
      });
    } catch (error) {
      try {
        await this.releaseSessionReservation(reserved, envelope.id);
      } catch {
        // Preserve the completion failure; reservation leases provide bounded recovery.
      }
      throw error;
    }
    return {
      ...withSession,
      laneOutput: routed.output,
      metadata: {
        ...withSession.metadata,
        route: { entryId: routed.entry.id, lane: routed.entry.lane },
        ...(this.substrate.observability === undefined
          ? {}
          : { trace: this.substrate.observability.trace.metadata() }),
      },
    };
  }

  normalizeKernelResponse(
    response: unknown,
    envelope: OrchestratedEnvelope,
    status: number,
  ): NormalizedKernelResponse {
    return normalizeKernelResponse(response, envelope, status);
  }
}

export const createSession = (
  envelope: EnforcedEnvelope,
  substrate: Substrate,
): Promise<StateModel<SessionState>> => new SessionOrchestrator(substrate).createSession(envelope);
export const resumeSession = (
  sessionId: string,
  substrate: Substrate,
): Promise<StateModel<SessionState>> => new SessionOrchestrator(substrate).resumeSession(sessionId);
export const attachIdentity = (
  envelope: Envelope,
  bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
): EnforcedEnvelope => {
  const identity = attachIdentityMetadata(envelope, bindings);
  const governance = attachGovernanceMetadata(envelope);
  return { ...envelope, metadata: { ...envelope.metadata, enforcement: { identity, governance } } };
};
export const attachGovernance = (envelope: EnforcedEnvelope): EnforcedEnvelope => {
  const governance = attachGovernanceMetadata(envelope);
  return {
    ...envelope,
    metadata: { ...envelope.metadata, enforcement: { ...envelope.metadata.enforcement, governance } },
  };
};
export const routeEnvelope = (
  envelope: EnforcedEnvelope,
  bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
  substrate: Substrate,
): Promise<OrchestratedEnvelope> => new SessionOrchestrator(substrate).routeEnvelope(envelope, bindings);
export const normalizeKernelResponse = (
  response: unknown,
  envelope: OrchestratedEnvelope,
  status: number,
): NormalizedKernelResponse => {
  if (!isJsonValue(response)) {
    throw new MaxOsError('KERNEL_INVALID_RESPONSE', 'Kernel response must be JSON serializable', 502);
  }
  const failed = isJsonObject(response) && response.ok === false;
  const error = failed
    ? (isJsonObject(response.error) ? response.error : {})
    : undefined;
  return error === undefined
    ? { ok: status >= 200 && status < 300, messageId: envelope.id, status, data: stableClone(response) }
    : {
        ok: false,
        messageId: envelope.id,
        status,
        error: {
          code: typeof error.code === 'string' ? error.code : 'KERNEL_ERROR',
          message: typeof error.message === 'string' ? error.message : 'Kernel request failed',
        },
      };
};
