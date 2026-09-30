import type { EnforcedEnvelope, Lane, LaneResponse } from '../types';

export type RoutingEntry = {
  id: string;
  lane: Lane;
  envelopeTypes: readonly string[];
  envelopeFields: readonly ('governanceContext' | 'identity' | 'sim' | 'tec' | 'universe')[];
};

export type RoutingMap = {
  entries: readonly RoutingEntry[];
  typeToEntry: Readonly<Record<string, string>>;
};

export type BeforeLaneCommit = () => Promise<void>;

export type LaneHandler = (
  envelope: EnforcedEnvelope,
  beforeCommit?: BeforeLaneCommit,
) => Promise<LaneResponse>;

export type LaneHandlers = Readonly<Record<Lane, LaneHandler>>;

export type RoutedLaneOutput = {
  entry: RoutingEntry;
  output: LaneResponse;
};
