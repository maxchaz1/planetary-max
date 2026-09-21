import type { JsonObject, JsonValue, KernelEnvelope } from '../contracts';

export interface MaxOsService {
  fetch(request: Request): Promise<Response>;
}

export interface MaxOsEnv {
  MAX_OS_1?: MaxOsService;
  MAXOS_URL?: string;
}

export interface MaxOsLaneResult {
  ok: true;
  envelopeId: string;
  lane: string;
  data: JsonValue;
  metadata: JsonObject;
}

export interface MaxOsKernelResult {
  ok: true;
  messageId: string;
  type: string;
  lanes: string[];
  results: MaxOsLaneResult[];
  output: JsonValue;
}

export class MaxOsClientError extends Error {
  constructor(
    readonly status: number,
    readonly response: unknown,
  ) {
    super(`MAX-OS-1 request failed (${status})`);
    this.name = 'MaxOsClientError';
  }
}

export async function callMaxOsKernel(
  env: MaxOsEnv,
  envelope: KernelEnvelope,
): Promise<MaxOsKernelResult> {
  const allowed = envelope.governanceContext.deny !== true;
  const body = JSON.stringify({
    ...envelope,
    type: envelope.type.replace(/^os\./, ''),
    identity: {
      credential: envelope.identity,
      id: 'planetary-max',
      type: 'service',
      authenticated: true,
      roles: ['kernel-caller'],
    },
    governanceContext: {
      umbrella: { allowed, policy: 'planetary-umbrella' },
      planetary: { allowed, policy: 'planetary-worker' },
      session: { allowed, policy: 'planetary-session' },
      ...(allowed ? {} : { deny: true }),
    },
  });
  const request = new Request('https://max-os-1/kernel/message', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${envelope.identity}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const response = env.MAX_OS_1
    ? await env.MAX_OS_1.fetch(request)
    : env.MAXOS_URL
      ? await fetch(`${env.MAXOS_URL.replace(/\/$/, '')}/kernel/message`, {
          method: request.method,
          headers: request.headers,
          body,
        })
      : undefined;
  if (!response) throw new MaxOsClientError(503, { error: 'MAX_OS_1 binding is not configured' });

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new MaxOsClientError(response.status, result);
  return result as MaxOsKernelResult;
}
