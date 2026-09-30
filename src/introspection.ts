// ==========================================================
// PORTAL-OS — Introspection Routes
// ==========================================================
// Worker-side, authenticated introspection endpoints backed by
// the PORTAL_KERNEL Durable Object.
// ==========================================================

import { Context, Hono } from 'hono';
import {
  Bindings,
  authenticatedIdentity,
  callKernel,
  createEnvelope,
  failureResponse,
  readKernelResult,
  resultResponse,
} from './kernel-bridge';

export type IntrospectionKind =
  | 'sim.behavior'
  | 'identity.timeline'
  | 'windows.focus'
  | 'umbrella.enforcement'
  | 'kernel.heatmap'
  | 'tec.pipeline'
  | 'substrate.state'
  | 'messages'
  | 'logs'
  | 'inference';

const INTROSPECTION_ROUTES: ReadonlyArray<readonly [string, IntrospectionKind]> = [
  ['/api/introspection/sim/behavior', 'sim.behavior'],
  ['/api/introspection/identity/timeline', 'identity.timeline'],
  ['/api/introspection/windows/focus', 'windows.focus'],
  ['/api/introspection/umbrella/enforcement', 'umbrella.enforcement'],
  ['/api/introspection/kernel/heatmap', 'kernel.heatmap'],
  ['/api/introspection/tec/pipeline', 'tec.pipeline'],
  ['/api/introspection/substrate/state', 'substrate.state'],
  ['/api/introspection/messages', 'messages'],
  ['/api/introspection/logs', 'logs'],
  ['/api/introspection/inference', 'inference'],
];

export interface IntrospectionMeta {
  kind: IntrospectionKind;
  source: 'kernel';
  timestamp: number;
  governance: 'strict' | 'advisory' | 'off';
  identity: { subject: string; propagated: boolean };
}

export interface IntrospectionResponse {
  ok: true;
  data: Record<string, unknown>;
  meta: IntrospectionMeta;
}

export function attachIntrospectionRoutes(app: Hono<{ Bindings: Bindings }>): void {
  for (const [path, kind] of INTROSPECTION_ROUTES) {
    app.get(path, (c) => handleIntrospection(c, kind));
  }
}

async function handleIntrospection(
  c: Context<{ Bindings: Bindings }>,
  kind: IntrospectionKind,
): Promise<Response> {
  const identity = await authenticatedIdentity(c.req.header('Authorization'), c.env);
  if (identity instanceof Response) return identity;

  const envelope = createEnvelope(
    `introspection.${kind}`,
    {},
    identity,
    { surface: 'introspection', kind },
    c.env.UMBRELLA_ENFORCEMENT,
  );

  try {
    const response = await callKernel(c.env, envelope);
    const result = await readKernelResult(response, envelope, 'PortalKernel');
    if (!result.ok) return resultResponse(result, response.status);

    const payload: IntrospectionResponse = {
      ok: true,
      data: result.data,
      meta: {
        kind,
        source: 'kernel',
        timestamp: Date.now(),
        governance: result.meta.governance.mode,
        identity: {
          subject: extractSubject(identity),
          propagated: result.meta.identity.propagated,
        },
      },
    };
    return c.json(payload, 200);
  } catch (error) {
    console.error(
      `[INTROSPECTION] ${kind} failed`,
      error instanceof Error ? error.message : String(error),
    );
    return failureResponse('INTROSPECTION_FAILED', `Introspection query for ${kind} failed`, 503);
  }
}

function extractSubject(token: string): string {
  try {
    const part = token.split('.')[1];
    if (!part) return 'unknown';
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as Record<string, unknown>;
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub : 'unknown';
  } catch {
    return 'unknown';
  }
}
