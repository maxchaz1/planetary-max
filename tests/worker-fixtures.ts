import type { JsonValue, KernelEnvelope } from '../src/contracts';
import { PortalKernel, type Bindings, type KernelService } from '../src/index';
import type { KernelStorage } from '../src/kernel-engine';

export const TOKEN = 'integration-token';

export class MemoryStorage implements KernelStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

export function envelope(overrides: Partial<KernelEnvelope> = {}): KernelEnvelope {
  return {
    id: 'message-1',
    type: 'sim',
    payload: { observation: 'stable' },
    identity: TOKEN,
    governanceContext: {},
    ...overrides,
  };
}

export function createKernelService(storage = new MemoryStorage()): KernelService {
  const state = { storage } as unknown as DurableObjectState;
  return new PortalKernel(state, {
    PLANETARY_MODE: 'single',
    UMBRELLA_ENFORCEMENT: 'strict',
  });
}

export function bindings(service: KernelService = createKernelService()): Bindings {
  return {
    PLANETARY_MODE: 'single',
    UMBRELLA_ENFORCEMENT: 'strict',
    PORTAL_KERNEL: {
      idFromName: () => ({ toString: () => 'portal-kernel' }) as DurableObjectId,
      get: () => service,
    },
  };
}

export async function responseJson(response: Response): Promise<Record<string, JsonValue>> {
  return response.json<Record<string, JsonValue>>();
}
