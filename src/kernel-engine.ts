import type { KernelEnvelope, KernelLaneResult, KernelResult } from './contracts';

type UniverseState = {
  started: boolean;
  tick: number;
  ecosystem: Record<string, unknown>;
};

export type LaneExecutionContext = {
  identity: string;
  governanceContext: Record<string, unknown>;
  planetaryMode: string;
  umbrellaEnforcement: string;
  storage: DurableObjectStorage;
};

export type LaneHandler = (
  envelope: KernelEnvelope,
  context: LaneExecutionContext,
) => Promise<unknown> | unknown;

const INITIAL_UNIVERSE: UniverseState = {
  started: false,
  tick: 0,
  ecosystem: { population: 0, resources: 100 },
};

const UMBRELLA_TYPES = [
  'apex.alignment.advisory',
  'umbrella.sim.pack',
  'umbrella.market.forecast',
  'umbrella.identity.mirror',
  'umbrella.crossworld.access',
  'structural.truth.license',
  'universe.umbrella',
] as const;

export class KernelEngine {
  private readonly lanes = new Map<string, LaneHandler>();
  private readonly routes = new Map<string, string[]>();

  constructor(private readonly context: LaneExecutionContext) {
    this.registerLane('identity-physics', identityPhysicsLane);
    this.registerLane('governance', governanceLane);
    this.registerLane('universe-state', universeStateLane);
    this.registerLane('umbrella-advisory', umbrellaAdvisoryLane);

    this.registerRoute('identity.physics.license', ['identity-physics']);
    this.registerRoute('governance.engine.license', ['governance']);
    this.registerRoute('autonomy.state', ['governance']);
    this.registerRoute('universe.start', ['universe-state']);
    this.registerRoute('universe.state', ['universe-state']);
    this.registerRoute('universe.tick', ['universe-state']);
    for (const type of UMBRELLA_TYPES) this.registerRoute(type, ['umbrella-advisory']);
  }

  registerLane(name: string, handler: LaneHandler): void {
    if (!name || this.lanes.has(name)) throw new Error(`Lane already registered: ${name}`);
    this.lanes.set(name, handler);
  }

  registerRoute(type: string, lanes: string[]): void {
    if (!type || lanes.length === 0) throw new Error('Kernel routes require a type and lane');
    this.routes.set(type, [...lanes]);
  }

  async dispatch(envelope: KernelEnvelope): Promise<KernelResult> {
    const route = this.routes.get(envelope.type);
    if (!route) return kernelError(envelope, 'INVALID_MESSAGE', `Unsupported message type: ${envelope.type}`);
    if (this.context.governanceContext.deny === true) {
      return kernelError(envelope, 'FORBIDDEN', 'Governance context denied this operation');
    }

    try {
      const lanes: KernelLaneResult[] = [];
      for (const laneName of route) {
        const handler = this.lanes.get(laneName);
        if (!handler) throw new Error(`No handler registered for lane: ${laneName}`);
        lanes.push(aggregateLaneResult(laneName, await handler(envelope, this.context)));
      }

      return {
        ok: true,
        messageId: envelope.id,
        type: envelope.type,
        identity: envelope.identity,
        route,
        result: { lanes },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kernel lane failed';
      return kernelError(envelope, 'KERNEL_ERROR', message);
    }
  }
}

function aggregateLaneResult(lane: string, data: unknown): KernelLaneResult {
  return {
    lane,
    result: {
      results: [{ result: { data } }],
    },
  };
}

function kernelError(envelope: KernelEnvelope, code: string, message: string): KernelResult {
  return { ok: false, messageId: envelope.id, error: { code, message } };
}

function identityPhysicsLane(
  envelope: KernelEnvelope,
  context: LaneExecutionContext,
): Record<string, unknown> {
  return {
    operation: envelope.type,
    licensed: true,
    identity: context.identity,
    mode: context.planetaryMode,
    attributes: envelope.payload,
  };
}

function governanceLane(
  envelope: KernelEnvelope,
  context: LaneExecutionContext,
): Record<string, unknown> {
  return {
    operation: envelope.type,
    authorized: true,
    identity: context.identity,
    enforcement: context.umbrellaEnforcement,
    mode: context.planetaryMode,
  };
}

async function universeStateLane(
  envelope: KernelEnvelope,
  context: LaneExecutionContext,
): Promise<Record<string, unknown>> {
  const current =
    (await context.storage.get<UniverseState>('universe')) ?? structuredClone(INITIAL_UNIVERSE);

  if (envelope.type === 'universe.start') {
    current.started = true;
    await context.storage.put('universe', current);
  } else if (envelope.type === 'universe.tick') {
    current.started = true;
    current.tick += 1;
    applyEcosystemChanges(current.ecosystem, envelope.payload.changes);
    await context.storage.put('universe', current);
  }

  return {
    operation: envelope.type,
    mode: context.planetaryMode,
    ...current,
  };
}

function umbrellaAdvisoryLane(
  envelope: KernelEnvelope,
  context: LaneExecutionContext,
): Record<string, unknown> {
  return {
    operation: envelope.type,
    active: true,
    advisory: envelope.payload,
    identity: context.identity,
    enforcement: context.umbrellaEnforcement,
    mode: context.planetaryMode,
    governanceContext: context.governanceContext,
  };
}

function applyEcosystemChanges(ecosystem: Record<string, unknown>, changes: unknown): void {
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return;
  for (const [key, value] of Object.entries(changes)) {
    const current = ecosystem[key];
    ecosystem[key] =
      typeof current === 'number' && typeof value === 'number' ? current + value : value;
  }
}
