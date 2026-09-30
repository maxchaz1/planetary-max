import { MaxOsError } from '../../errors';
import type { StateModel } from '../models/state';
import type { Repository, StateCodec } from '../repositories/repository';

export class D1StateRepository<T> implements Repository<T> {
  readonly consistency = 'strong' as const;
  constructor(
    private readonly database: D1Database,
    private readonly codec: StateCodec<T>,
    table = 'maxos_state',
  ) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new TypeError('Invalid D1 state table name');
    this.table = `"${table}"`;
  }

  private readonly table: string;

  async create(model: StateModel<T>): Promise<StateModel<T>> {
    const result = await this.database
      .prepare(`INSERT OR IGNORE INTO ${this.table} (key, version, state) VALUES (?, ?, ?)`)
      .bind(model.key, model.version, this.codec.encode(model))
      .run();
    if (result.meta.changes !== 1) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} already exists`, 409);
    }
    return model;
  }

  async read(key: string): Promise<StateModel<T> | null> {
    const row = await this.database
      .prepare(`SELECT state FROM ${this.table} WHERE key = ?`)
      .bind(key)
      .first<{ state: string }>();
    return row === null ? null : this.codec.decode(JSON.parse(row.state));
  }

  async update(model: StateModel<T>, expectedVersion: number): Promise<StateModel<T>> {
    const result = await this.database
      .prepare(`UPDATE ${this.table} SET version = ?, state = ? WHERE key = ? AND version = ?`)
      .bind(model.version, this.codec.encode(model), model.key, expectedVersion)
      .run();
    if (result.meta.changes !== 1) {
      throw new MaxOsError('STATE_CONFLICT', `State ${model.key} version conflict`, 409);
    }
    return model;
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.database.prepare(`DELETE FROM ${this.table} WHERE key = ?`).bind(key).run();
    return result.meta.changes === 1;
  }
}
