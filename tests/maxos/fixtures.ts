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

export function d1Database(): D1Database {
  const rows = new Map<string, { version: number; state: string }>();
  return {
    prepare(sql: string) {
      let parameters: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          parameters = values;
          return statement;
        },
        async run() {
          const [key, version, state, expectedVersion] = parameters as [string, number, string, number];
          if (sql.startsWith('INSERT OR IGNORE')) {
            if (rows.has(key)) return { meta: { changes: 0 } };
            rows.set(key, { version, state });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE')) {
            const current = rows.get(key);
            if (!current || current.version !== expectedVersion) return { meta: { changes: 0 } };
            rows.set(key, { version, state });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE')) return { meta: { changes: Number(rows.delete(key)) } };
          throw new Error(`Unsupported test SQL: ${sql}`);
        },
        async first<T>() {
          const [key] = parameters as [string];
          const row = rows.get(key);
          return (row ? { state: row.state } : null) as T | null;
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
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
    PLANETARY_MODE: 'single',
    UMBRELLA_ENFORCEMENT: 'strict',
    MAX_OS_VERSION: '1',
    PORTAL_OS_PHASE: '11',
    KERNEL_TIMEOUT_MS: '5000',
    SUBSTRATE_TIMEOUT_MS: '3000',
    MAX_RETRY_ATTEMPTS: '3',
    RETRY_BASE_DELAY_MS: '1',
    CIRCUIT_FAILURE_THRESHOLD: '5',
    CIRCUIT_COOLDOWN_MS: '30000',
    KERNEL_SERVICE: { fetch } as unknown as Fetcher,
    DB: d1Database(),
  };
}
