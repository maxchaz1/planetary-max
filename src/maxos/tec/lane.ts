import { isJsonObject, stableClone } from '../stable';
import type { TECState, StateModel } from '../state/models/state';
import type { Substrate } from '../state/substrate';
import type { Envelope, JsonObject, TECResponse } from '../types';
import type { BeforeLaneCommit } from '../routing/types';

function stateKey(envelope: Envelope): string {
  return `tec:${envelope.sessionId ?? envelope.identity.id}`;
}

function requestedActions(envelope: Envelope): JsonObject[] {
  const actions = envelope.payload.actions;
  if (!Array.isArray(actions)) return [stableClone(envelope.payload)];
  return actions.filter(isJsonObject).map((action) => stableClone(action));
}

export async function maintainTECState(
  envelope: Envelope,
  substrate: Substrate,
  beforeCommit?: BeforeLaneCommit,
): Promise<StateModel<TECState>> {
  const key = stateKey(envelope);
  const current = await substrate.readTEC(key);
  const actionCount = requestedActions(envelope).length;
  const next: TECState = {
    actionCount: (current?.value.actionCount ?? 0) + actionCount,
    executions: (current?.value.executions ?? 0) + 1,
    lastEnvelopeId: envelope.id,
  };
  await beforeCommit?.();
  return substrate.transitionTEC({
    id: `tec:${envelope.id}`,
    key,
    expectedVersion: current?.version ?? 0,
    next,
  });
}

export function normalizeTECOutput(state: StateModel<TECState>): JsonObject {
  return stableClone({
    actionCount: state.value.actionCount,
    executions: state.value.executions,
    lastEnvelopeId: state.value.lastEnvelopeId,
  });
}

export async function processTECEnvelope(
  envelope: Envelope,
  substrate: Substrate,
  beforeCommit?: BeforeLaneCommit,
): Promise<TECResponse> {
  const state = await maintainTECState(envelope, substrate, beforeCommit);
  return {
    ok: true,
    envelopeId: envelope.id,
    lane: 'tec',
    stateVersion: state.version,
    data: normalizeTECOutput(state),
    metadata: { deterministic: true, stateful: true },
  };
}
