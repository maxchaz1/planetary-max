export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type KernelEnvelope = {
  id: string;
  type: string;
  payload: JsonObject;
  identity: string;
  governanceContext: JsonObject;
};

export type KernelLane = 'cognitive' | 'governance' | 'orchestration' | 'substrate';

export type KernelLaneResult = {
  lane: KernelLane;
  data: JsonValue;
};

export type KernelSuccess = {
  ok: true;
  messageId: string;
  type: string;
  identity: string;
  route: KernelLane[];
  lanes: KernelLane[];
  results: KernelLaneResult[];
  output: JsonValue;
};

export type KernelFailure = {
  ok: false;
  messageId?: string;
  error: { code: string; message: string };
};

export type KernelResult = KernelSuccess | KernelFailure;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function parseKernelEnvelope(value: unknown): KernelEnvelope {
  if (!isRecord(value)) throw new KernelContractError('INVALID_MESSAGE', 'Kernel envelope must be an object');
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new KernelContractError('INVALID_MESSAGE', 'Kernel envelope id must be a non-empty string');
  }
  if (typeof value.type !== 'string' || value.type.trim() === '') {
    throw new KernelContractError('INVALID_MESSAGE', 'Kernel envelope type must be a non-empty string');
  }
  if (!isJsonObject(value.payload)) {
    throw new KernelContractError('INVALID_MESSAGE', 'Kernel envelope payload must be an object');
  }
  if (typeof value.identity !== 'string' || value.identity.trim() === '') {
    throw new KernelContractError('UNAUTHENTICATED', 'Kernel envelope identity must be a non-empty string');
  }
  if (!isJsonObject(value.governanceContext)) {
    throw new KernelContractError('INVALID_MESSAGE', 'Kernel envelope governanceContext must be an object');
  }
  return {
    id: value.id,
    type: value.type,
    payload: value.payload,
    identity: value.identity,
    governanceContext: value.governanceContext,
  };
}

export class KernelContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KernelContractError';
  }
}
