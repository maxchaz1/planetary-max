import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  isJsonObject,
  isRecord,
  KernelContractError,
  parseKernelEnvelope,
  type JsonObject,
  type KernelEnvelope,
  type KernelResult,
} from './contracts';
import { KernelEngine } from './kernel-engine';
import {
  callMaxOsKernel,
  MaxOsClientError,
  type MaxOsEnv,
} from './kernel-bridge/max-os-client';

export type KernelService = {
  fetch(request: Request): Promise<Response>;
};

export type KernelNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): KernelService;
};

export type Bindings = MaxOsEnv & {
  PORTAL_KERNEL: KernelNamespace;
  KERNEL_SERVICE?: KernelService;
  KERNEL_URL?: string;
  PLANETARY_MODE?: string;
  UMBRELLA_ENFORCEMENT?: string;
};

type UmbrellaOperation =
  | 'identity.physics.license'
  | 'governance.engine.license'
  | 'apex.alignment.advisory'
  | 'umbrella.sim.pack'
  | 'umbrella.market.forecast'
  | 'umbrella.identity.mirror'
  | 'umbrella.crossworld.access'
  | 'structural.truth.license';

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

app.get('/', (context) => context.json({
  status: 'Portal-OS live',
  worker: 'planetary-max',
  mode: context.env.PLANETARY_MODE,
  umbrella: context.env.UMBRELLA_ENFORCEMENT,
}));

app.get('/health', (context) => context.json({ status: 'ok', service: 'planetary-max' }));

app.post('/api/kernel/message', async (context) => {
  const identity = bearerToken(context.req.header('Authorization'));
  if (!identity) return unauthenticated();

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return invalidJson('Request body must be JSON');
  }
  if (!isRecord(body) || typeof body.type !== 'string' || body.type.trim() === '') {
    return invalidMessage('type and object payload are required');
  }
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isJsonObject(payload)) return invalidMessage('type and object payload are required');

  const envelope = createEnvelope(
    body.type,
    payload,
    identity,
    isJsonObject(body.governanceContext) ? body.governanceContext : {},
    typeof body.id === 'string' && body.id.trim() !== '' ? body.id : undefined,
  );
  return kernelResponse(context.env, envelope);
});

app.post('/os/kernel/message', async (context) => {
  const identity = bearerToken(context.req.header('Authorization'));
  if (!identity) return unauthenticated();

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return invalidJson('Request body must be JSON');
  }
  if (!isRecord(body) || typeof body.type !== 'string' || body.type.trim() === '') {
    return invalidMessage('type and object payload are required');
  }
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isJsonObject(payload)) return invalidMessage('type and object payload are required');
  const envelope = createEnvelope(
    body.type,
    payload,
    identity,
    isJsonObject(body.governanceContext) ? body.governanceContext : {},
    typeof body.id === 'string' && body.id.trim() !== '' ? body.id : undefined,
  );

  try {
    const result = await callMaxOsKernel(context.env, envelope);
    return context.json({
      ok: true,
      data: result,
      meta: { source: 'max-os-1', via: 'planetary-max → MAX-OS-1' },
    });
  } catch (error) {
    if (error instanceof MaxOsClientError) {
      return Response.json(
        { ok: false, error: error.response, meta: { source: 'max-os-1', status: error.status } },
        { status: error.status },
      );
    }
    return Response.json(
      { ok: false, error: { message: 'MAX-OS-1 bridge unavailable' } },
      { status: 503 },
    );
  }
});

app.get('/api/autonomy', async (context) =>
  normalizedRequest(context.env, context.req.header('Authorization'), 'autonomy.state', {}));
app.get('/universe/state', async (context) =>
  normalizedRequest(context.env, context.req.header('Authorization'), 'universe.state', {}));
app.get('/universe/umbrella', async (context) =>
  normalizedRequest(context.env, context.req.header('Authorization'), 'universe.umbrella', {}));

const umbrellaRoutes: ReadonlyArray<readonly [string, UmbrellaOperation]> = [
  ['/umbrella/identity/license', 'identity.physics.license'],
  ['/umbrella/governance/license', 'governance.engine.license'],
  ['/umbrella/apex/advisory', 'apex.alignment.advisory'],
  ['/umbrella/sim/pack', 'umbrella.sim.pack'],
  ['/umbrella/market/forecast', 'umbrella.market.forecast'],
  ['/umbrella/identity/mirror', 'umbrella.identity.mirror'],
  ['/umbrella/crossworld/access', 'umbrella.crossworld.access'],
  ['/umbrella/structural/truth/license', 'structural.truth.license'],
];

for (const [route, operation] of umbrellaRoutes) {
  app.post(route, (context) => umbrellaRequest(
    context.env,
    context.req.header('Authorization'),
    context.req.raw,
    operation,
  ));
}

app.post('/universe/tick', async (context) => {
  let payload: JsonObject = {};
  const contentType = context.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return invalidJson('Request body must be JSON');
    }
    if (!isJsonObject(body)) return invalidJson('Tick payload must be an object');
    payload = body;
  }
  return normalizedRequest(context.env, context.req.header('Authorization'), 'universe.tick', payload);
});

async function normalizedRequest(
  env: Bindings,
  authorization: string | undefined,
  type: string,
  payload: JsonObject,
): Promise<Response> {
  const identity = bearerToken(authorization);
  if (!identity) return unauthenticated();
  return kernelResponse(env, createEnvelope(type, payload, identity, { surface: 'worker-api' }), true);
}

async function umbrellaRequest(
  env: Bindings,
  authorization: string | undefined,
  request: Request,
  type: UmbrellaOperation,
): Promise<Response> {
  const identity = bearerToken(authorization);
  if (!identity) return unauthenticated();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalidJson('Umbrella payload must be JSON');
  }
  if (!isJsonObject(payload)) return invalidJson('Umbrella payload must be an object');
  return kernelResponse(
    env,
    createEnvelope(type, payload, identity, { surface: 'worker-umbrella' }),
    true,
  );
}

export function createEnvelope(
  type: string,
  payload: JsonObject,
  identity: string,
  governanceContext: JsonObject,
  id: string = crypto.randomUUID(),
): KernelEnvelope {
  return { id, type, payload, identity, governanceContext };
}

async function kernelResponse(
  env: Bindings,
  envelope: KernelEnvelope,
  normalize = false,
): Promise<Response> {
  try {
    const response = await callKernel(env, envelope);
    const result = await response.json<KernelResult>();
    const status = result.ok ? response.status : kernelErrorStatus(result.error.code);
    if (!result.ok || !normalize) return Response.json(result, { status });
    return Response.json(normalizeResponse(result, envelope), { status });
  } catch (error) {
    console.error('Worker to kernel bridge failed', error);
    return Response.json(
      { ok: false, error: { code: 'KERNEL_UNAVAILABLE', message: 'Kernel bridge unavailable' } },
      { status: 503 },
    );
  }
}

export function normalizeResponse(
  result: KernelResult,
  envelope: KernelEnvelope,
): Record<string, unknown> {
  if (!result.ok) return result;
  return {
    ok: true,
    data: extractLaneData(result),
    meta: {
      messageId: result.messageId ?? envelope.id,
      type: result.type ?? envelope.type,
      identity: result.identity ?? envelope.identity,
      route: result.route ?? result.lanes,
    },
  };
}

export function extractLaneData(response: unknown): unknown {
  if (!isRecord(response)) return {};
  if ('output' in response) return response.output;
  const results = response.results;
  if (Array.isArray(results) && isRecord(results[0]) && 'data' in results[0]) return results[0].data;

  if (!isRecord(response.result)) return {};
  const legacyLanes = response.result.lanes;
  if (!Array.isArray(legacyLanes) || !isRecord(legacyLanes[0]) || !isRecord(legacyLanes[0].result)) return {};
  const legacyResults = legacyLanes[0].result.results;
  if (!Array.isArray(legacyResults) || !isRecord(legacyResults[0]) || !isRecord(legacyResults[0].result)) return {};
  return legacyResults[0].result.data ?? {};
}

export async function callKernel(env: Bindings, envelope: KernelEnvelope): Promise<Response> {
  if (envelope.type.startsWith('os.') && (env.MAX_OS_1 || env.MAXOS_URL)) {
    try {
      return Response.json(await callMaxOsKernel(env, envelope));
    } catch (error) {
      if (error instanceof MaxOsClientError) {
        return Response.json(error.response, { status: error.status });
      }
      throw error;
    }
  }

  const body = JSON.stringify(envelope);
  const request = new Request('http://portal-kernel/api/kernel/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (env.PORTAL_KERNEL) {
    const id = env.PORTAL_KERNEL.idFromName('portal-kernel');
    return env.PORTAL_KERNEL.get(id).fetch(request);
  }
  if (env.KERNEL_SERVICE) return env.KERNEL_SERVICE.fetch(request);
  if (env.KERNEL_URL) {
    const target = `${env.KERNEL_URL.replace(/\/$/, '')}/api/kernel/message`;
    return fetch(target, { method: 'POST', headers: request.headers, body });
  }
  throw new Error('Configure PORTAL_KERNEL, KERNEL_SERVICE or KERNEL_URL');
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim() || null;
}

function kernelErrorStatus(code: string): number {
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'INVALID_MESSAGE' || code === 'INVALID_JSON' || code === 'ROUTE_NOT_FOUND') return 400;
  if (code === 'INVARIANT_VIOLATION') return 422;
  return 500;
}

function unauthenticated(): Response {
  return Response.json(
    { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Bearer token required' } },
    { status: 401 },
  );
}

function invalidJson(message: string): Response {
  return Response.json({ ok: false, error: { code: 'INVALID_JSON', message } }, { status: 400 });
}

function invalidMessage(message: string): Response {
  return Response.json({ ok: false, error: { code: 'INVALID_MESSAGE', message } }, { status: 400 });
}

export class PortalKernel {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Pick<Bindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/api/kernel/message', '/kernel/message'].includes(url.pathname)) {
      return Response.json({ status: 'ok', service: 'portal-kernel' });
    }

    let rawEnvelope: unknown;
    try {
      rawEnvelope = await request.json();
    } catch {
      return invalidJson('Kernel envelope must be JSON');
    }

    try {
      const envelope = parseKernelEnvelope(rawEnvelope);
      const result = await new KernelEngine(
        this.state.storage,
        this.env.PLANETARY_MODE,
        this.env.UMBRELLA_ENFORCEMENT,
      ).dispatch(envelope);
      return Response.json(result);
    } catch (error) {
      const failure = error instanceof KernelContractError
        ? error
        : new KernelContractError('KERNEL_ERROR', 'Kernel execution failed');
      return Response.json(
        {
          ok: false,
          messageId: isRecord(rawEnvelope) && typeof rawEnvelope.id === 'string' ? rawEnvelope.id : undefined,
          error: { code: failure.code, message: failure.message },
        },
        { status: kernelErrorStatus(failure.code) },
      );
    }
  }
}

export { app };
export default app;
