import type { Envelope } from '../types';
import type { RoutingEntry, RoutingMap } from './types';

const ENTRIES = [
  { id: 'identity-lane', lane: 'identity', envelopeTypes: ['identity'], envelopeFields: ['identity'] },
  { id: 'governance-lane', lane: 'governance', envelopeTypes: ['governance'], envelopeFields: ['governanceContext'] },
  {
    id: 'universe-lane',
    lane: 'universe',
    envelopeTypes: ['universe.start', 'universe.tick', 'universe.state', 'universe.umbrella'],
    envelopeFields: ['universe'],
  },
  { id: 'sim-lane', lane: 'sim', envelopeTypes: ['cognitive', 'sim'], envelopeFields: ['sim'] },
  { id: 'tec-lane', lane: 'tec', envelopeTypes: ['task', 'tec'], envelopeFields: ['tec'] },
] as const satisfies readonly RoutingEntry[];

export const ROUTING_TABLE: RoutingMap = Object.freeze({
  entries: ENTRIES,
  typeToEntry: Object.freeze(
    Object.fromEntries(ENTRIES.flatMap((entry) => entry.envelopeTypes.map((type) => [type, entry.id]))),
  ),
});

function entryById(id: string | undefined): RoutingEntry | undefined {
  return ROUTING_TABLE.entries.find((entry) => entry.id === id);
}

function routeByField(envelope: Envelope, field: RoutingEntry['envelopeFields'][number]): RoutingEntry | undefined {
  return envelope[field] === undefined
    ? undefined
    : ROUTING_TABLE.entries.find((entry) => entry.envelopeFields.includes(field));
}

export function routeByEnvelopeType(envelope: Envelope): RoutingEntry | undefined {
  return entryById(ROUTING_TABLE.typeToEntry[envelope.type]);
}

export function routeByIdentity(envelope: Envelope): RoutingEntry | undefined {
  return routeByField(envelope, 'identity');
}

export function routeByGovernance(envelope: Envelope): RoutingEntry | undefined {
  return routeByField(envelope, 'governanceContext');
}

export function routeByUniverse(envelope: Envelope): RoutingEntry | undefined {
  return routeByField(envelope, 'universe');
}

export function routeBySIM(envelope: Envelope): RoutingEntry | undefined {
  return routeByField(envelope, 'sim');
}

export function routeByTEC(envelope: Envelope): RoutingEntry | undefined {
  return routeByField(envelope, 'tec');
}
