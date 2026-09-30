import type { StateModel } from '../models/state';

export interface Repository<T> {
  readonly consistency: 'strong';
  create(model: StateModel<T>): Promise<StateModel<T>>;
  read(key: string): Promise<StateModel<T> | null>;
  update(model: StateModel<T>, expectedVersion: number): Promise<StateModel<T>>;
  delete(key: string): Promise<boolean>;
}

export type StateCodec<T> = {
  decode(value: unknown): StateModel<T>;
  encode(value: StateModel<T>): string;
};

export function createStateCodec<T>(validateValue: (value: unknown) => value is T): StateCodec<T> {
  return {
    decode(value: unknown): StateModel<T> {
      const candidate = value as Partial<StateModel<unknown>> | null;
      if (
        candidate === null
        || typeof candidate !== 'object'
        || typeof candidate.key !== 'string'
        || typeof candidate.version !== 'number'
        || !Number.isInteger(candidate.version)
        || candidate.version < 1
        || !Array.isArray(candidate.appliedTransitions)
        || !candidate.appliedTransitions.every((id) => typeof id === 'string')
        || !validateValue(candidate.value)
      ) {
        throw new TypeError('Stored state does not match the repository codec');
      }
      return {
        key: candidate.key,
        version: candidate.version,
        value: candidate.value,
        appliedTransitions: [...candidate.appliedTransitions],
      };
    },
    encode(value: StateModel<T>): string {
      return JSON.stringify(value);
    },
  };
}
