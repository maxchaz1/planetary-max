import type { Envelope, GovernanceEnvelope, IdentityEnvelope, MaxOsBindings } from '../../src/maxos/types';

export const identity: IdentityEnvelope = {
  credential: 'test-service-token',
  id: 'identity-1',
  type: 'service',
  authenticated: true,
  roles: ['operator'],
};

export const governanceContext: GovernanceEnvelope = {
  umbrella: { allowed: true, policy: 'umbrella-v1' },
  planetary: { allowed: true, policy: 'planetary-v1' },
  session: { allowed: true, policy: 'session-v1' },
};

type StoredR2Object = {
  etag: string;
  value: string;
};

export function r2Bucket(): R2Bucket {
  const objects = new Map<string, StoredR2Object>();
  let version = 0;
  return {
    async get(key: string) {
      const stored = objects.get(key);
      if (stored === undefined) return null;
      return {
        etag: stored.etag,
        json: async <T>() => JSON.parse(stored.value) as T,
      };
    },
    async put(
      key: string,
      value: string,
      options?: { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } },
    ) {
      const current = objects.get(key);
      if (options?.onlyIf?.etagDoesNotMatch === '*' && current !== undefined) return null;
      if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) return null;
      version += 1;
      const stored = { etag: `etag-${version}`, value };
      objects.set(key, stored);
      return { key, etag: stored.etag };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

export function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'message-1',
    type: 'sim',
    payload: { observation: 'stable' },
    identity,
    governanceContext,
    ...overrides,
  };
}

export function bindings(fetch: (request: Request) => Promise<Response> = async () => Response.json({ ok: true })):
MaxOsBindings {
  return {
    PLANETARY_MODE: 'active',
    UMBRELLA_ENFORCEMENT: 'enabled',
    MAX_OS_VERSION: '1',
    PORTAL_OS_PHASE: '11',
    KERNEL_TIMEOUT_MS: '5000',
    SUBSTRATE_TIMEOUT_MS: '3000',
    MAX_RETRY_ATTEMPTS: '3',
    RETRY_BASE_DELAY_MS: '1',
    CIRCUIT_FAILURE_THRESHOLD: '5',
    CIRCUIT_COOLDOWN_MS: '30000',
    KERNEL_SERVICE: { fetch } as unknown as Fetcher,
    MAXOS_STATE: r2Bucket(),
  };
}
