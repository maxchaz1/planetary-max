export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

export type UmbrellaMode = 'strict' | 'advisory' | 'off';
export type PlanetaryMode = 'single' | 'multi' | 'crossworld' | 'umbrella' | string;

export type KernelNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): KernelService;
};

export type KernelService = {
  fetch(request: Request): Promise<Response>;
};

export type Bindings = {
  PORTAL_KERNEL?: KernelNamespace;
  KERNEL_SERVICE?: KernelService;
  KERNEL_URL?: string;
  MAX_OS_1?: KernelService;
  IDENTITY_JWT_SECRET?: string;
  IDENTITY_JWT_ISSUER?: string;
  IDENTITY_JWT_AUDIENCE?: string;
  PLANETARY_MODE?: PlanetaryMode;
  UMBRELLA_ENFORCEMENT?: UmbrellaMode;
  [key: string]: unknown;
};

export type KernelEnvelope = {
  id: string;
  type: string;
  payload: JsonObject;
  identity: string;
  governanceContext: JsonObject & {
    tenant?: string;
    deny?: boolean;
    allowedLanes?: string[];
    umbrellaMode?: UmbrellaMode;
    [key: string]: JsonValue | undefined;
  };
  identityCurvature?: number;
  entropyTick?: number;
  planetaryMode?: PlanetaryMode;
  umbrellaEnforcement?: UmbrellaMode;
  laneRouting?: {
    lane?: string;
    route?: string[];
    [key: string]: JsonValue | undefined;
  };
  metadata?: JsonObject;
};

export type KernelLaneResult = {
  lane: string;
  result: {
    results: Array<{
      result: {
        data: JsonValue;
        meta?: JsonObject;
      };
    }>;
  };
};

export type KernelLane = {
  name: string;
  route?: string[];
  result?: {
    results?: Array<{
      result?: {
        data?: JsonValue;
        meta?: JsonObject;
      };
    }>;
  };
  metadata?: JsonObject;
};

export type KernelResultSuccess = {
  ok: true;
  messageId?: string;
  type?: string;
  identity?: string;
  route?: string[];
  data?: JsonValue;
  lanes?: KernelLane[];
  result?: {
    lanes?: KernelLaneResult[];
    [key: string]: unknown;
  };
  meta?: JsonObject;
  error?: never;
  [key: string]: unknown;
};

export type KernelResultFailure = {
  ok: false;
  messageId?: string;
  type?: string;
  identity?: string;
  route?: string[];
  data?: JsonValue;
  lanes?: KernelLane[];
  result?: {
    lanes?: KernelLaneResult[];
    [key: string]: unknown;
  };
  meta?: JsonObject;
  error: {
    code: string;
    message: string;
    details?: JsonValue;
  };
  [key: string]: unknown;
};

export type KernelResult = KernelResultSuccess | KernelResultFailure;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isKernelResult(value: unknown): value is KernelResult {
  return isRecord(value) && 'ok' in value && (value.ok === true || value.ok === false);
}
