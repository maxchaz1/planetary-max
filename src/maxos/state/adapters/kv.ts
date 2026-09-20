import type { StateModel } from '../models/state';
import type { StateCodec } from '../repositories/repository';

/** Eventually consistent snapshot storage; it is intentionally not an authoritative Repository. */
export class KVStateRepository<T> {
  readonly consistency = 'eventual' as const;
  constructor(
    private readonly namespace: KVNamespace,
    private readonly codec: StateCodec<T>,
    private readonly prefix = 'maxos:',
  ) {}

  async writeSnapshot(model: StateModel<T>): Promise<void> {
    await this.namespace.put(this.storageKey(model.key), this.codec.encode(model));
  }

  async readSnapshot(key: string): Promise<StateModel<T> | null> {
    const value = await this.namespace.get(this.storageKey(key), 'json');
    return value === null ? null : this.codec.decode(value);
  }

  async deleteSnapshot(key: string): Promise<void> {
    await this.namespace.delete(this.storageKey(key));
  }

  private storageKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
