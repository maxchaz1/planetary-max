import { mergeJson, stableClone } from '../stable';
import type { Substrate } from '../state/substrate';
import type { SIMState, StateModel } from '../state/models/state';
import type { Envelope, JsonObject, SIMResponse } from '../types';
import type { BeforeLaneCommit } from '../routing/types';

function stateKey(envelope: Envelope): string {
  return `sim:${envelope.sessionId ?? envelope.identity.id}`;
}

export async function maintainSIMState(
  envelope: Envelope,
  substrate: Substrate,
  beforeCommit?: BeforeLaneCommit,
): Promise<StateModel<SIMState>> {
  const key = stateKey(envelope);
  const current = await substrate.readSIM(key);
  const next: SIMState = {
    lastEnvelopeId: envelope.id,
    memory: mergeJson(current?.value.memory ?? {}, envelope.payload),
    steps: (current?.value.steps ?? 0) + 1,
  };
  await beforeCommit?.();
  return substrate.transitionSIM({
    id: `sim:${envelope.id}`,
    key,
    expectedVersion: current?.version ?? 0,
    next,
  });
}

export function produceSIMOutput(state: StateModel<SIMState>): JsonObject {
  return stableClone({
    lastEnvelopeId: state.value.lastEnvelopeId,
    memory: state.value.memory,
    steps: state.value.steps,
  });
}

export function attachSIMMetadata(response: SIMResponse): SIMResponse {
  return {
    ...response,
    metadata: {
      ...response.metadata,
      deterministic: true,
      stateful: true,
    },
  };
}

export async function processSIMEnvelope(
  envelope: Envelope,
  substrate: Substrate,
  beforeCommit?: BeforeLaneCommit,
): Promise<SIMResponse> {
  const state = await maintainSIMState(envelope, substrate, beforeCommit);
  return attachSIMMetadata({
    ok: true,
    envelopeId: envelope.id,
    lane: 'sim',
    stateVersion: state.version,
    data: produceSIMOutput(state),
    metadata: {},
  });
}
