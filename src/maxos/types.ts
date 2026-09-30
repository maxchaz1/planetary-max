import type { ObservabilityContext } from './observability/tracing';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type IdentityEnvelope = {
  credential: string;
  id: string;
  type: 'user' | 'service' | 'system';
  authenticated: boolean;
  roles: string[];
  attributes?: JsonObject;
};

export type GovernanceRule = {
  allowed: boolean;
  policy: string;
};

export type GovernanceEnvelope = {
  umbrella: GovernanceRule;
  planetary: GovernanceRule;
  session: GovernanceRule;
  deny?: boolean;
  tenant?: string;
};

export type IdentityMetadata = {
  identityId: string;
  identityType: IdentityEnvelope['type'];
  roles: string[];
  planetaryMode: string;
  umbrellaEnforcement: string;
  structurallyValidated: true;
};

export type GovernanceMetadata = {
  policies: string[];
  tenant?: string;
  umbrellaEnforced: true;
  planetaryEnforced: true;
  sessionEnforced: true;
  validated: true;
};

export type EnforcementMetadata = {
  identity: IdentityMetadata;
  governance: GovernanceMetadata;
};

export type RouteMetadata = {
  entryId: string;
  lane: Lane;
};

export type TraceMetadata = {
  traceId: string;
  spans: JsonObject;
};

export type EnvelopeMetadata = {
  enforcement?: EnforcementMetadata;
  route?: RouteMetadata;
  trace?: TraceMetadata;
  [key: string]: JsonValue | EnforcementMetadata | RouteMetadata | TraceMetadata | undefined;
};

export type Envelope = {
  id: string;
  type: string;
  payload: JsonObject;
  identity: IdentityEnvelope;
  governanceContext: GovernanceEnvelope;
  sessionId?: string;
  universe?: JsonObject;
  sim?: JsonObject;
  tec?: JsonObject;
  metadata?: EnvelopeMetadata;
};

export type EnforcedEnvelope = Envelope & {
  metadata: EnvelopeMetadata & {
    enforcement: EnforcementMetadata;
  };
};

export type Lane = 'governance' | 'identity' | 'sim' | 'tec' | 'universe';

export type LaneResponse<TLane extends Lane = Lane, TData extends JsonValue = JsonValue> = {
  ok: true;
  envelopeId: string;
  lane: TLane;
  data: TData;
  metadata: JsonObject;
};

export type UniverseResponse = LaneResponse<'universe', JsonObject> & {
  operation: string;
};

export type SIMResponse = LaneResponse<'sim', JsonObject> & {
  stateVersion: number;
};

export type TECResponse = LaneResponse<'tec', JsonObject> & {
  stateVersion: number;
};

export type OrchestratedEnvelope = EnforcedEnvelope & {
  sessionId: string;
  laneOutput: LaneResponse;
  metadata: EnforcedEnvelope['metadata'] & {
    route: RouteMetadata;
  };
};

export type NormalizedKernelResponse = {
  ok: boolean;
  messageId: string;
  status: number;
  data?: JsonValue;
  error?: {
    code: string;
    message: string;
  };
};

export type MaxOsBindings = {
  PLANETARY_MODE: string;
  UMBRELLA_ENFORCEMENT: string;
  MAX_OS_VERSION: string;
  PORTAL_OS_PHASE: string;
  KERNEL_SERVICE: Fetcher;
  MAXOS_STATE: R2Bucket;
  KERNEL_TIMEOUT_MS: string;
  SUBSTRATE_TIMEOUT_MS: string;
  MAX_RETRY_ATTEMPTS: string;
  RETRY_BASE_DELAY_MS: string;
  CIRCUIT_FAILURE_THRESHOLD: string;
  CIRCUIT_COOLDOWN_MS: string;
};

export type MaxOsVariables = {
  maxosEnvelope: EnforcedEnvelope;
  maxosObservability: ObservabilityContext;
};

export type MaxOsHonoEnv = {
  Bindings: MaxOsBindings;
  Variables: MaxOsVariables;
};
