export type KernelEnvelope = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  identity: string;
  governanceContext: Record<string, unknown>;
};

export type KernelService = {
  fetch(request: Request): Promise<Response>;
};

export type KernelNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): KernelService;
};

export type Bindings = {
  PORTAL_KERNEL?: KernelNamespace;
  KERNEL_SERVICE?: KernelService;
  KERNEL_URL?: string;
  MAX_OS_1?: KernelService;
  IDENTITY_JWT_SECRET?: string;
  IDENTITY_JWT_ISSUER?: string;
  IDENTITY_JWT_AUDIENCE?: string;
  PLANETARY_MODE?: string;
  UMBRELLA_ENFORCEMENT?: string;
};

export type KernelLane = {
  name: string;
  result?: {
    results?: Array<{
      result?: {
        data?: unknown;
        meta?: Record<string, unknown>;
      };
    }>;
  };
};

export type KernelLaneResult = {
  lane: string;
  result: {
    results: Array<{
      result: {
        data: unknown;
        meta?: Record<string, unknown>;
      };
    }>;
  };
};

export type KernelResult = {
  ok: boolean;
  messageId?: unknown;
  type?: unknown;
  identity?: unknown;
  route?: unknown;
  data?: unknown;
  lanes?: KernelLane[];
  result?: {
    lanes?: KernelLane[];
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
