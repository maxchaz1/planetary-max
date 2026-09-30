import type { Bindings, KernelEnvelope } from './contracts';

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
  payload: Record<string, unknown>,
  identity: string,
  governanceContext: Record<string, unknown>,
  umbrellaMode?: string,
): KernelEnvelope {
  return {
    id: `envelope-${crypto.randomUUID()}`,
    type,
    payload,
    identity,
    governanceContext: {
      ...governanceContext,
      umbrellaMode: umbrellaMode || 'strict',
    },
  };
}

export function extractLaneData(lanes: Array<{ name: string; result?: { results?: Array<{ result?: { data?: unknown } }> } }>): unknown {
  for (const lane of lanes) {
    const result = lane.result?.results?.[0]?.result?.data;
    if (result) return result;
  }
  return null;
}

export function normalizeResponse(response: unknown): unknown {
  if (typeof response === 'object' && response !== null && 'ok' in response) {
    return response;
  }
  return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Response format invalid' } };
}

export function failureResponse(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export function resultResponse(result: unknown, status: number): Response {
  return Response.json(result, { status });
}

export async function readKernelResult(
  response: Response,
  envelope: KernelEnvelope,
  source: string,
): Promise<unknown> {
  const data = await response.json();
  return { ok: response.ok, data, meta: { source, type: envelope.type, identity: { propagated: true }, governance: { mode: 'strict' } } };
}

export async function authenticatedIdentity(authHeader: string | undefined, env: Bindings): Promise<string | Response> {
  if (!authHeader?.startsWith('Bearer ')) {
    return failureResponse('UNAUTHENTICATED', 'Missing or invalid Bearer token', 401);
  }
  return authHeader.slice(7);
}
