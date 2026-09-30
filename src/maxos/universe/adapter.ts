import { MaxOsError } from '../errors';
import { enforcePlanetaryRules, enforceSessionRules, enforceUmbrellaRules } from '../governance/lane';
import { isJsonValue, stableClone } from '../stable';
import type { Envelope, JsonObject, UniverseResponse } from '../types';

export type UniverseEnvelope = {
  envelopeId: string;
  operation: string;
  payload: JsonObject;
  sessionId?: string;
};

export function enforceUniverseGovernance(envelope: Envelope): void {
  enforceUmbrellaRules(envelope.governanceContext);
  enforcePlanetaryRules(envelope.governanceContext);
  enforceSessionRules(envelope.governanceContext);
}

export function adaptEnvelopeToUniverse(envelope: Envelope): UniverseEnvelope {
  enforceUniverseGovernance(envelope);
  return {
    envelopeId: envelope.id,
    operation: envelope.type.replace(/^universe\./, ''),
    payload: stableClone(envelope.universe ?? envelope.payload),
    ...(envelope.sessionId === undefined ? {} : { sessionId: envelope.sessionId }),
  };
}

export function adaptUniverseResponse(envelope: Envelope, output: unknown): UniverseResponse {
  if (!isJsonValue(output)) {
    throw new MaxOsError('INVALID_ENVELOPE', 'Universe output must be JSON serializable', 500);
  }
  const universe = adaptEnvelopeToUniverse(envelope);
  const data: JsonObject = {
    operation: universe.operation,
    output: stableClone(output),
  };
  return {
    ok: true,
    envelopeId: envelope.id,
    lane: 'universe',
    operation: universe.operation,
    data,
    metadata: { normalized: true },
  };
}
