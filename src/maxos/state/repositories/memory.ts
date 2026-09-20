import { MaxOsError } from '../../errors';
import type { StateModel } from '../models/state';
import type { Repository } from './repository';

export class InMemoryRepository<T> implements Repository<T> {
  readonly consistency = 'strong' as const;
  private readonly records = new Map<string, StateModel<T>>();

  async create(model: StateModel<T>): Promise<StateModel<T>> {
    if (this.records.has(model.key)) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} already exists`, 409);
    }
    const stored = structuredClone(model);
    this.records.set(model.key, stored);
    return structuredClone(stored);
  }

  async read(key: string): Promise<StateModel<T> | null> {
    const model = this.records.get(key);
    return model === undefined ? null : structuredClone(model);
  }

  async update(model: StateModel<T>, expectedVersion: number): Promise<StateModel<T>> {
    const current = this.records.get(model.key);
    if (current === undefined || current.version !== expectedVersion) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} version conflict`, 409);
    }
    const stored = structuredClone(model);
    this.records.set(model.key, stored);
    return structuredClone(stored);
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key);
  }
}
