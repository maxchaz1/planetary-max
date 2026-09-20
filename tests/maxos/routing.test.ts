import { describe, expect, it } from 'vitest';
import { MaxOsRouter } from '../../src/maxos/routing/router';
import {
  ROUTING_TABLE,
  routeByEnvelopeType,
  routeByGovernance,
  routeByIdentity,
  routeBySIM,
  routeByTEC,
  routeByUniverse,
} from '../../src/maxos/routing/table';
import { Substrate } from '../../src/maxos/state/substrate';
import { enforceEnvelope } from '../../src/maxos/middleware/enforcement';
import { envelope } from './fixtures';

const modes = { PLANETARY_MODE: 'active', UMBRELLA_ENFORCEMENT: 'enabled' };

describe('declarative routing table', () => {
  it('maps types and envelope fields without route condition chains', () => {
    expect(ROUTING_TABLE.entries).toHaveLength(5);
    expect(routeByEnvelopeType(envelope())?.lane).toBe('sim');
    expect(routeByIdentity(envelope())?.lane).toBe('identity');
    expect(routeByGovernance(envelope())?.lane).toBe('governance');
    expect(routeByUniverse(envelope({ universe: {} }))?.lane).toBe('universe');
    expect(routeBySIM(envelope({ sim: {} }))?.lane).toBe('sim');
    expect(routeByTEC(envelope({ tec: {} }))?.lane).toBe('tec');
  });

  it('dispatches the selected lane and rejects unknown routes', async () => {
    const router = new MaxOsRouter(new Substrate());
    await expect(router.routeEnvelope(enforceEnvelope(envelope({ type: 'tec' }), modes)))
      .resolves.toMatchObject({ entry: { lane: 'tec' }, output: { lane: 'tec' } });
    await expect(router.routeEnvelope(enforceEnvelope(envelope({ type: 'unknown' }), modes)))
      .rejects.toThrowError(/No MAX-OS-1 route/);
  });
});
