import {
  KernelContractError,
  type JsonObject,
  type JsonValue,
  type KernelEnvelope,
  type KernelLane,
  type KernelLaneResult,
  type KernelSuccess,
} from './contracts';

export interface KernelStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

type UniverseState = {
  started: boolean;
  tick: number;
  ecosystem: JsonObject;
};

type SimState = {
  version: number;
  observations: JsonValue[];
};

const DEFAULT_UNIVERSE: UniverseState = {
  started: false,
  tick: 0,
  ecosystem: { population: 0, resources: 100 },
};

export const LANE_REGISTRY: Readonly<Record<string, readonly KernelLane[]>> = Object.freeze({
  sim: ['cognitive'],
  cognitive: ['cognitive'],
  tec: ['orchestration'],
  task: ['orchestration'],
  substrate: ['substrate'],
  governance: ['governance'],
  'autonomy.state': ['cognitive'],
  'universe.start': ['orchestration'],
  'universe.tick': ['orchestration'],
  'universe.state': ['orchestration'],
  'universe.umbrella': ['orchestration'],
  'ecosystem.step': ['cognitive', 'orchestration', 'substrate'],
  'identity.physics.license': ['governance'],
  'governance.engine.license': ['governance'],
  'apex.alignment.advisory': ['governance'],
  'umbrella.sim.pack': ['governance'],
  'umbrella.market.forecast': ['governance'],
  'umbrella.identity.mirror': ['governance'],
  'umbrella.crossworld.access': ['governance'],
  'structural.truth.license': ['governance'],
});

export class KernelEngine {
  constructor(
    private readonly storage: KernelStorage,
    private readonly mode = 'single',
    private readonly umbrellaEnforcement = 'strict',
  ) {}

  async dispatch(envelope: KernelEnvelope): Promise<KernelSuccess> {
    this.enforceGovernance(envelope);
    const lanes = LANE_REGISTRY[envelope.type];
    if (!lanes) throw new KernelContractError('ROUTE_NOT_FOUND', `Unsupported message type: ${envelope.type}`);

    const results: KernelLaneResult[] = [];
    for (const lane of lanes) {
      results.push({ lane, data: await this.dispatchLane(lane, envelope) });
    }

    const output = results.length === 1
      ? results[0].data
      : Object.fromEntries(results.map(({ lane, data }) => [lane, data]));
    return {
      ok: true,
      messageId: envelope.id,
      type: envelope.type,
      identity: envelope.identity,
      route: [...lanes],
      lanes: [...lanes],
      results,
      output,
    };
  }

  private enforceGovernance(envelope: KernelEnvelope): void {
    if (envelope.governanceContext.deny === true) {
      throw new KernelContractError('FORBIDDEN', 'Governance context denied the request');
    }
  }

  private dispatchLane(lane: KernelLane, envelope: KernelEnvelope): Promise<JsonValue> {
    if (lane === 'cognitive') return this.cognitive(envelope);
    if (lane === 'orchestration') return this.orchestration(envelope);
    if (lane === 'substrate') return this.substrate(envelope);
    return Promise.resolve({
      authorized: true,
      identity: envelope.identity,
      mode: this.mode,
      operation: envelope.type,
      umbrellaEnforcement: this.umbrellaEnforcement,
    });
  }

  private async cognitive(envelope: KernelEnvelope): Promise<JsonValue> {
    if (envelope.type === 'autonomy.state') {
      return { mode: this.mode, umbrellaEnforcement: this.umbrellaEnforcement };
    }
    const current = await this.storage.get<SimState>('sim') ?? { version: 0, observations: [] };
    const observation = envelope.payload.observation ?? envelope.payload;
    const next: SimState = {
      version: current.version + 1,
      observations: [...current.observations, structuredClone(observation)].slice(-100),
    };
    await this.storage.put('sim', next);
    return { stateVersion: next.version, observations: next.observations };
  }

  private async orchestration(envelope: KernelEnvelope): Promise<JsonValue> {
    if (envelope.type === 'universe.start') {
      const state = await this.universe();
      const next = { ...state, started: true };
      await this.storage.put('universe', next);
      return next;
    }
    if (envelope.type === 'universe.tick' || envelope.type === 'ecosystem.step') {
      const state = await this.universe();
      const rawChanges = envelope.type === 'ecosystem.step'
        ? envelope.payload.universe
        : envelope.payload;
      const changeContainer = isObject(rawChanges) ? rawChanges : {};
      const changes = isObject(changeContainer.changes) ? changeContainer.changes : {};
      const ecosystem = { ...state.ecosystem };
      for (const [key, value] of Object.entries(changes)) {
        const current = ecosystem[key];
        ecosystem[key] = typeof current === 'number' && typeof value === 'number'
          ? current + value
          : structuredClone(value);
      }
      const next: UniverseState = { started: true, tick: state.tick + 1, ecosystem };
      await this.storage.put('universe', next);
      return next;
    }
    if (envelope.type === 'universe.state') return this.universe();
    if (envelope.type === 'universe.umbrella') {
      const state = await this.universe();
      return {
        active: state.started,
        governance: 'umbrella',
        enforcement: this.umbrellaEnforcement,
        violations: [],
      };
    }

    const actions = Array.isArray(envelope.payload.actions) ? envelope.payload.actions : [envelope.payload];
    if (actions.length > 16) {
      throw new KernelContractError('INVARIANT_VIOLATION', 'TEC execution must remain bounded to 16 actions');
    }
    return { accepted: true, actionCount: actions.length, operation: envelope.type };
  }

  private async substrate(envelope: KernelEnvelope): Promise<JsonValue> {
    const key = typeof envelope.payload.key === 'string'
      ? envelope.payload.key
      : `message/${envelope.id}`;
    if (envelope.payload.operation === 'read') {
      return { key, value: await this.storage.get<JsonValue>(`substrate/${key}`) ?? null };
    }
    const value = envelope.payload.value ?? envelope.payload;
    await this.storage.put(`substrate/${key}`, structuredClone(value));
    return { key, stored: true, value };
  }

  private async universe(): Promise<UniverseState> {
    return await this.storage.get<UniverseState>('universe') ?? structuredClone(DEFAULT_UNIVERSE);
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
