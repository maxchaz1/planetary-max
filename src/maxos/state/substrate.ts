import type { ObservabilityContext } from '../observability/tracing';
import { MaxOsError, SubstrateError } from '../resilience/errors';
import { retry, type RetryPolicy } from '../resilience/retries';
import { substrateTimeout, withTimeout } from '../resilience/timeouts';
import { D1StateRepository } from './adapters/d1';
import {
  isSessionState,
  isSIMState,
  isTECState,
  isUniverseState,
  type SessionState,
  type SIMState,
  type StateModel,
  type StateTransition,
  type TECState,
  type UniverseState,
} from './models/state';
import { InMemoryRepository } from './repositories/memory';
import { createStateCodec, type Repository } from './repositories/repository';

export type SubstrateRepositories = {
  sessions: Repository<SessionState>;
  sim: Repository<SIMState>;
  tec: Repository<TECState>;
  universe: Repository<UniverseState>;
};

export type SubstrateOptions = {
  observability?: ObservabilityContext;
  retry?: RetryPolicy;
  timeoutMs?: number;
};

export class Substrate {
  readonly repositories: SubstrateRepositories;
  readonly observability?: ObservabilityContext;
  private readonly retryPolicy: RetryPolicy;
  private readonly timeoutMs: number;

  constructor(
    repositories: Partial<SubstrateRepositories> = {},
    options: SubstrateOptions = {},
  ) {
    this.repositories = {
      sessions: repositories.sessions ?? new InMemoryRepository<SessionState>(),
      sim: repositories.sim ?? new InMemoryRepository<SIMState>(),
      tec: repositories.tec ?? new InMemoryRepository<T​​ECState>(),
      universe: repositories.universe ?? new InMemoryRepository<UniverseState>(),
    };
    this.observability = options.observability;
    this.retryPolicy = options.retry ?? { baseDelayMs: 0, maxAttempts: 1 };
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  transitionSession(transition: StateTransition<SessionState>): Promise<StateModel<SessionState>> {
    return this.executeOperation('session.transition', () => this.applyTransition(this.repositories.sessions, transition));
  }

  transitionSIM(transition: StateTransition<SIMState>): Promise<StateModel<SIMState>> {
    return this.executeOperation('sim.transition', () => this.applyTransition(this.repositories.sim, transition));
  }

  transitionTEC(transition: StateTransition<T​​ECState>): Promise<StateModel<T​​ECState>> {
    return this.executeOperation('tec.transition', () => this.applyTransition(this.repositories.tec, transition));
  }

  transitionUniverse(transition: StateTransition<UniverseState>): Promise<StateModel<UniverseState>> {
    return this.executeOperation('universe.transition', () => this.applyTransition(this.repositories.universe, transition));
  }

  readSession(key: string): Promise<StateModel<SessionState> | null> {
    return this.executeOperation('session.read', () => this.repositories.sessions.read(key));
  }

  readSIM(key: string): Promise<StateModel<SIMState> | null> {
    return this.executeOperation('sim.read', () => this.repositories.sim.read(key));
  }

  readTEC(key: string): Promise<StateModel<T​​ECState> | null> {
    return this.executeOperation('tec.read', () => this.repositories.tec.read(key));
  }

  readUniverse(key: string): Promise<StateModel<UniverseState> | null> {
    return this.executeOperation('universe.read', () => this.repositories.universe.read(key));
  }

  private async applyTransition<T>(repository: Repository<T>, transition: StateTransition<T>): Promise<StateModel<T>> {
    const current = await repository.read(transition.key);
    if (current?.appliedTransitions.includes(transition.id)) return current;
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== transition.expectedVersion) {
      throw new MaxOsError('STATE_CONFLICT', `State ${transition.key} version conflict`, 409);
    }
    const next: StateModel<T> = {
      key: transition.key,
      version: currentVersion + 1,
      value: structuredClone(transition.next),
      appliedTransitions: [...(current?.appliedTransitions ?? []), transition.id],
    };
    try {
      return current === null
        ? await repository.create(next)
        : await repository.update(next, currentVersion);
    } catch (error) {
      const latest = error instanceof MaxOsError && error.code === 'STATE_CONFLICT'
        ? await repository.read(transition.key)
        : null;
      if (latest?.appliedTransitions.includes(transition.id)) return latest;
      throw error;
    }
  }

  private async executeOperation<T>(operation: string, execute: () => Promise<T>): Promise<T> {
    const span = await this.observability?.trace.startSpan(`substrate.${operation}`);
    const stopTimer = this.observability?.metrics.timer('maxos_substrate_latency_ms', { operation });
    this.observability?.metrics.increment('maxos_substrate_operations_total', { operation });
    try {
      const result = await retry(
        () => withTimeout(
          async () => {
            try {
              return await execute();
            } catch (error) {
              if (error instanceof MaxOsError) throw error;
              throw new SubstrateError('Substrate operation is unavailable', 'SUBSTRATE_UNAVAILABLE', 503, true);
            }
          },
          { timeoutMs: this.timeoutMs, createError: () => substrateTimeout(this.timeoutMs) },
        ),
        this.retryPolicy,
        {
          shouldRetry: (error) => error instanceof SubstrateError && error.retryable,
          onRetry: (attempt, delayMs) => {
            this.observability?.metrics.increment('maxos_substrate_retries_total', { operation });
            this.observability?.logger.warn('substrate.retry', {
              attempt,
              delayMs,
              operation,
              spanId: span?.spanId,
            });
          },
        },
      );
      const latencyMs = stopTimer?.();
      this.observability?.logger.debug('substrate.success', {
        latencyMs,
        operation,
        spanId: span?.spanId,
      });
      return result;
    } catch (error) {
      stopTimer?.();
      this.observability?.metrics.increment('maxos_failures_total', { stage: 'substrate' });
      this.observability?.logger.error('substrate.failure', { operation, spanId: span?.spanId });
      throw error;
    }
  }
}

export function createD1Substrate(database: D1Database, options: SubstrateOptions = {}): Substrate {
  return new Substrate(
    {
      sessions: new D1StateRepository(database, createStateCodec(isSessionState), 'maxos_state'),
      sim: new D1StateRepository(database, createStateCodec(isSIMState), 'maxos_state'),
      tec: new D1StateRepository(database, createStateCodec(isTECState), 'maxos_state'),
      universe: new D1StateRepository(database, createStateCodec(isUniverseState), 'maxos_state'),
    },
    options,
  );
}
