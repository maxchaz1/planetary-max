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
  PLANETARY_MODE?: string;
  UMBRELLA_ENFORCEMENT?: string;
};

export type KernelLaneResult = {
  lane: string;
  result: {
    results: Array<{
      result: {
        data: unknown;
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
  result?: {
    lanes?: KernelLaneResult[];
    [key: string]: unknown;
  };
  error?: { code?: string; message?: string };
  [key: string]: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
