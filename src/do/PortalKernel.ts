import type {
  JsonValue,
  KernelEnvelope,
  KernelResult,
  PlanetaryMode,
  UmbrellaMode,
} from '../contracts';

import {
  createEnvelope,
  failureResponse,
  resultResponse,
  resolveUmbrellaMode,
} from '../kernel-bridge';

export class PortalKernel {
  async fetch(request: Request): Promise<Response> {
    return new Response('PortalKernel active', { status: 200 });
  }
}
