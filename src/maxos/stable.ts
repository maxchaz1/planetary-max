import type { JsonObject, JsonValue } from './types';

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

export function stableClone<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stableClone(item)) as T;
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, stableClone(item)]),
    ) as T;
  }
  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(stableClone(value));
}

export async function deterministicId(namespace: string, value: JsonValue): Promise<string> {
  const input = `${namespace}:${stableStringify(value)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${namespace}_${hash}`;
}

export function mergeJson(current: JsonObject, delta: JsonObject): JsonObject {
  return stableClone({ ...current, ...delta });
}
