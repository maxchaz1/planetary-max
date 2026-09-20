import { describe, expect, it } from 'vitest';
import { processSIMEnvelope } from '../../src/maxos/sim/lane';
import { Substrate } from '../../src/maxos/state/substrate';
import { processTECEnvelope } from '../../src/maxos/tec/lane';
import { adaptEnvelopeToUniverse, adaptUniverseResponse } from '../../src/maxos/universe/adapter';
import { envelope } from './fixtures';

describe('MAX-OS-1 lanes', () => {
  it('produces deterministic, idempotent SIM output', async () => {
    const substrate = new Substrate();
    const input = envelope({ id: 'sim-idempotency' });
    expect(await processSIMEnvelope(input, substrate)).toEqual(await processSIMEnvelope(input, substrate));
  });

  it('produces deterministic, idempotent TEC output', async () => {
    const substrate = new Substrate();
    const input = envelope({ id: 'tec-idempotency', type: 'tec', payload: { actions: [{ id: 'act-1' }] } });
    expect(await processTECEnvelope(input, substrate)).toEqual(await processTECEnvelope(input, substrate));
  });

  it('normalizes universe input and output', () => {
    const input = envelope({ type: 'universe.tick', universe: { changes: { population: 1 } } });
    expect(adaptEnvelopeToUniverse(input)).toMatchObject({ operation: 'tick', envelopeId: 'message-1' });
    expect(adaptUniverseResponse(input, { tick: 1 })).toMatchObject({
      lane: 'universe',
      operation: 'tick',
      data: { output: { tick: 1 } },
    });
  });
});
