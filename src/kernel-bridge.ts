import type {
  JsonObject,
  JsonValue,
  Bindings,
  KernelEnvelope,
  KernelLane,
  KernelResult,
  PlanetaryMode,
} from './contracts';

export type { Bindings, JsonObject, JsonValue };
export type UmbrellaMode = 'strict' | 'advisory' | 'off';

export const UMBRELLA_MODES = ['strict', 'advisory', 'off'] as const;

export function resolveUmbrellaMode(value?: string | UmbrellaMode | null): UmbrellaMode {
  if (value === 'strict' || value === 'advisory' || value === 'off') {
    return value;
  }
  return 'strict';
}

export function resolvePlanetaryMode(value?: string | PlanetaryMode | null): PlanetaryMode {
  if (
    value === 'single' ||
    value === 'multi' ||
    value === 'crossworld' ||
    value === 'umbrella'
  ) {
    return value;
  }
  return 'single';
}

export async function callKernel(env: Bindings, envelope: KernelEnvelope): Promise<Response> {
  const body = JSON.stringify(envelope);
  const request = new Request('http://kernel/api/kernel/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (env.PORTAL_KERNEL) {
    const id = env.PORTAL_KERNEL.idFromName('portal-kernel');
    const kernel = env.PORTAL_KERNEL.get(id);
    return kernel.fetch(request);
  }

  if (env.KERNEL_SERVICE) return env.KERNEL_SERVICE.fetch(request);

  if (env.KERNEL_URL) {
    const target = `${env.KERNEL_URL.replace(/\/$/, '')}/api/kernel/message`;
    return fetch(target, { method: 'POST', headers: request.headers, body });
  }

  throw new Error('Configure PORTAL_KERNEL, KERNEL_SERVICE or KERNEL_URL');
}

export function createEnvelope(
  type: string,
  payload: JsonObject,
  identity: string,
  governanceContext: JsonObject,
  umbrellaMode?: UmbrellaMode,
  planetaryMode?: PlanetaryMode,
): KernelEnvelope {
  return {
    id: `envelope-${crypto.randomUUID()}`,
    type,
    payload,
    identity,
    governanceContext: {
      ...governanceContext,
      umbrellaMode: resolveUmbrellaMode(umbrellaMode),
    },
    identityCurvature: 1,
    entropyTick: 0,
    planetaryMode: resolvePlanetaryMode(planetaryMode),
    umbrellaEnforcement: resolveUmbrellaMode(umbrellaMode),
    laneRouting: {
      route: [type],
      lane: type.split('.').slice(0, -1).join('.') || type,
    },
    metadata: { source: 'kernel-bridge' },
  };
}

export function extractLaneData(lanes: KernelLane[]): unknown {
  for (const lane of lanes) {
    const result = lane.result?.results?.[0]?.result?.data;
    if (result !== undefined) return result;
  }
  return null;
}

export function normalizeResponse(response: unknown): unknown {
  if (typeof response === 'object' && response !== null && 'ok' in response) {
    return response;
  }
  return {
    ok: false,
    error: {
      code: 'INVALID_RESPONSE',
      message: 'Response format invalid',
    },
  } satisfies KernelResult;
}

export function failureResponse(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export function resultResponse(result: KernelResult | JsonObject, status: number): Response {
  return Response.json(result, { status });
}

export async function readKernelResult(
  response: Response,
  envelope?: Partial<KernelEnvelope>,
  source = 'kernel',
): Promise<KernelResult> {
  const parsed = await safeJson(response);
  if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) {
    return parsed as KernelResult;
  }

  const umbrellaMode = envelope?.governanceContext?.umbrellaMode;
  const modeValue = typeof umbrellaMode === 'string' ? umbrellaMode : undefined;

  return {
    ok: false,
    messageId: envelope?.id,
    type: envelope?.type ?? 'unknown',
    identity: envelope?.identity,
    meta: {
      source,
      responseStatus: response.status,
      envelopeType: envelope?.type ?? 'unknown',
      envelope: {
        type: envelope?.type ?? 'unknown',
        id: envelope?.id ?? 'unknown',
        planetaryMode: envelope?.planetaryMode ?? 'single',
        umbrellaEnforcement: envelope?.umbrellaEnforcement ?? 'strict',
        entropyTick: envelope?.entropyTick ?? 0,
      },
      governance: { mode: resolveUmbrellaMode(modeValue) },
    },
    error: {
      code: 'INVALID_RESPONSE',
      message: 'Kernel response was not a valid Phase-12 result payload',
      details: typeof parsed === 'object' && parsed !== null ? (parsed as JsonValue) : undefined,
    },
  };
}

export async function authenticatedIdentity(authHeader: string | undefined, _env: Bindings): Promise<string | Response> {
  if (!authHeader?.startsWith('Bearer ')) {
    return failureResponse('UNAUTHENTICATED', 'Missing or invalid Bearer token', 401);
  }
  return authHeader.slice(7);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
