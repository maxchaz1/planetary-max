import { MaxOsError } from '../../errors';
import type { StateModel } from '../models/state';
import type { Repository, StateCodec } from '../repositories/repository';

const TOMBSTONE = { maxosRepositoryTombstone: true } as const;

function isTombstone(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'maxosRepositoryTombstone' in value
    && value.maxosRepositoryTombstone === true;
}

export class R2StateRepository<T> implements Repository<T> {
  readonly consistency = 'strong' as const;
  constructor(
    private readonly bucket: R2Bucket,
    private readonly codec: StateCodec<T>,
    private readonly prefix = 'maxos/',
  ) {}

  async create(model: StateModel<T>): Promise<StateModel<T>> {
    const existing = await this.bucket.get(this.storageKey(model.key));
    const existingValue = existing === null ? null : await existing.json<unknown>();
    if (existing !== null && !isTombstone(existingValue)) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} already exists`, 409);
    }
    const result = await this.bucket.put(this.storageKey(model.key), this.codec.encode(model), {
      onlyIf: existing === null
        ? { etagDoesNotMatch: '*' }
        : { etagMatches: existing.etag },
    });
    if (result === null) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} already exists`, 409);
    }
    return model;
  }

  async read(key: string): Promise<StateModel<T> | null> {
    const object = await this.bucket.get(this.storageKey(key));
    if (object === null) return null;
    const value = await object.json<unknown>();
    return isTombstone(value) ? null : this.codec.decode(value);
  }

  async update(model: StateModel<T>, expectedVersion: number): Promise<StateModel<T>> {
    const object = await this.bucket.get(this.storageKey(model.key));
    const value = object === null ? null : await object.json<unknown>();
    const current = value === null || isTombstone(value) ? null : this.codec.decode(value);
    if (object === null || current === null || current.version !== expectedVersion) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} version conflict`, 409);
    }
    const result = await this.bucket.put(this.storageKey(model.key), this.codec.encode(model), {
      onlyIf: { etagMatches: object.etag },
    });
    if (result === null) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} version conflict`, 409);
    }
    return model;
  }

  async delete(key: string): Promise<boolean> {
    const object = await this.bucket.get(this.storageKey(key));
    if (object === null) return false;
    const value = await object.json<unknown>();
    if (isTombstone(value)) return false;
    const result = await this.bucket.put(this.storageKey(key), JSON.stringify(TOMBSTONE), {
      onlyIf: { etagMatches: object.etag },
    });
    if (result === null) {
      throw new MaxOsError('STATE_CONFLICT', `State ${key} changed before deletion`, 409);
    }
    return true;
  }

  private storageKey(key: string): string {
    return `${this.prefix}${key}.json`;
  }
}
