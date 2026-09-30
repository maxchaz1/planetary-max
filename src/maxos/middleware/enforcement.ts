import type { MiddlewareHandler } from 'hono';
import { MaxOsError, toErrorResponse } from '../errors';
import { enforceGovernance } from '../governance/enforcer';
import { enforceIdentity } from '../identity/enforcer';
import { defaultLogger, type StructuredLogger } from '../observability/logger';
import { defaultMetrics, type Metrics } from '../observability/metrics';
import { createObservabilityContext } from '../observability/tracing';
import { isJsonObject } from '../stable';
import type {
  EnforcedEnvelope,
  Envelope,
  GovernanceEnvelope,
  IdentityEnvelope,
  MaxOsBindings,
  MaxOsHonoEnv,
} from '../types';

function hasIdentityShape(value: unknown): value is IdentityEnvelope {
  if (!isJsonObject(value)) return false;
  return typeof value.credential === 'string'
    && value.credential.trim().length > 0
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.type === 'string'
    && ['service', 'system', 'user'].includes(value.type)
    && typeof value.authenticated === 'boolean'
    && Array.isArray(value.roles)
    && value.roles.length > 0
    && value.roles.every((role) => typeof role === 'string' && role.trim().length > 0)
    && (value.attributes === undefined || isJsonObject(value.attributes));
}

function hasGovernanceShape(value: unknown): value is GovernanceEnvelope {
  if (!isJsonObject(value)) return false;
  const scopes = ['planetary', 'session', 'umbrella'];
  return scopes.every((scope) => {
    const rule = value[scope];
    return isJsonObject(rule)
      && typeof rule.allowed === 'boolean'
      && typeof rule.policy === 'string'
      && rule.policy.trim().length > 0;
  })
    && (value.deny === undefined || typeof value.deny === 'boolean')
    && (value.tenant === undefined || (typeof value.tenant === 'string' && value.tenant.trim().length > 0));
}

export function parseEnvelope(value: unknown): Envelope {
  if (!isJsonObject(value)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope must be a JSON object', 400);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope id must be a non-empty string', 400);
  }
  if (typeof candidate.type !== 'string' || candidate.type.trim().length === 0) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope type must be a non-empty string', 400);
  }
  if (!isJsonObject(candidate.payload)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope payload must be a JSON object', 400);
  }
  if (!hasIdentityShape(candidate.identity)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope identity is malformed', 400);
  }
  if (!hasGovernanceShape(candidate.governanceContext)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope governance context is malformed', 400);
  }
  const sessionId = candidate.sessionId;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim().length === 0)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Envelope sessionId must be a non-empty string', 400);
  }
  for (const field of ['sim', 'tec', 'universe'] as const) {
    if (candidate[field] !== undefined && !isJsonObject(candidate[field])) {
      throw new MaxOsError('INVALID_ENVELOPE', `Envelope ${field} must be a JSON object`, 400);
    }
  }
  return {
    id: candidate.id,
    type: candidate.type,
    payload: candidate.payload,
    identity: candidate.identity,
    governanceContext: candidate.governanceContext,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(isJsonObject(candidate.universe) ? { universe: candidate.universe } : {}),
    ...(isJsonObject(candidate.sim) ? { sim: candidate.sim } : {}),
    ...(isJsonObject(candidate.tec) ? { tec: candidate.tec } : {}),
  };
}

export function enforceEnvelope(
  envelope: Envelope,
  bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
): EnforcedEnvelope {
  const identity = enforceIdentity(envelope, bindings);
  const governance = enforceGovernance(envelope);
  return {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      enforcement: { identity, governance },
    },
  };
}

export function createEnforcementMiddleware(
  logger: StructuredLogger = defaultLogger,
  metrics: Metrics = defaultMetrics,
): MiddlewareHandler<MaxOsHonoEnv> {
  return async (context, next) => {
    metrics.increment('maxos_requests_total');
    const stopRequestTimer = metrics.timer('maxos_request_latency_ms');
    let requestLogger = logger;
    try {
      try {
        const envelope = parseEnvelope(await context.req.json<unknown>());
        const observability = await createObservabilityContext(envelope.id, logger, metrics);
        requestLogger = observability.logger;
        const span = await observability.trace.startSpan('enforcement');
        const enforced = enforceEnvelope(envelope, context.env);
        enforced.metadata.trace = observability.trace.metadata();
        observability.logger.info('enforcement.allowed', {
          enforcement: 'allowed',
          sessionId: enforced.sessionId,
          spanId: span.spanId,
        });
        context.set('maxosObservability', observability);
        context.set('maxosEnvelope', enforced);
      } catch (error) {
        metrics.increment('maxos_failures_total', { stage: 'enforcement' });
        requestLogger.warn('enforcement.denied', {
          enforcement: 'denied',
          errorCode: error instanceof MaxOsError ? error.code : 'INVALID_ENVELOPE',
        });
        return toErrorResponse(
          error instanceof SyntaxError
            ? new MaxOsError('INVALID_ENVELOPE', 'Request body must contain valid JSON', 400)
            : error,
        );
      }
      await next();
    } finally {
      stopRequestTimer();
    }
  };
}
