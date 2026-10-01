// ==========================================================
// PHASE 13.0 — COMPLETE PORTALKERNEL RUNTIME
// Umbrella kernel runtime with sim core, identity flow, and result enrichment
// ==========================================================

import type {
  JsonObject,
  KernelEnvelope,
  KernelResult,
} from '../contracts';

import {
  failureResponse,
  resultResponse,
  resolveUmbrellaMode,
} from '../kernel-bridge';

import { KernelEngine, type LaneExecutionContext } from '../kernel-engine';
import { initializeSimCore, stepSimCore } from '../sim-core';
import { computeIdentityCurvature, updateIdentityState } from '../identity-engine';
import { resolveUmbrellaField, resolveUmbrellaPath, isLaneAdmitted } from '../umbrella-field';
import { computeCollapseVector } from '../collapse-vector';
import { indexPattern } from '../pattern-index';
import { emitTelemetry } from '../telemetry';
import { generateDailyBrief } from '../daily-brief';

export class PortalKernel {
  private engine: KernelEngine | null = null;
  private simCoreState: JsonObject | null = null;
  private identityState: JsonObject | null = null;
  private resultHistory: Array<{ ok: boolean; processingTime?: number }> = [];

  async fetch(request: Request): Promise<Response> {
    try {
      const envelope = await this.parseEnvelope(request);

      if (!envelope) {
        return failureResponse('INVALID_REQUEST', 'Request body is not a valid KernelEnvelope', 400);
      }

      if (!this.engine || !this.simCoreState || !this.identityState) {
        this.initializeKernel(envelope);
      }

      if (!this.engine || !this.simCoreState || !this.identityState) {
        return failureResponse('KERNEL_INIT_FAILED', 'Kernel initialization failed', 500);
      }

      const umbrellaField = resolveUmbrellaField({
        governanceContext: envelope.governanceContext,
        umbrellaMode: envelope.umbrellaEnforcement ?? 'strict',
        identity: envelope.identity,
      });

      const umbrellaPath = resolveUmbrellaPath({
        laneRouting: envelope.laneRouting ?? {
          lane: envelope.type,
          route: [envelope.type],
        },
        governanceContext: envelope.governanceContext,
        umbrellaMode: envelope.umbrellaEnforcement ?? 'strict',
      });

      const selectedLane = envelope.laneRouting?.lane ?? envelope.type;
      if (!isLaneAdmitted(umbrellaField, selectedLane)) {
        const failure: KernelResult = {
          ok: false,
          messageId: envelope.id,
          type: envelope.type,
          identity: envelope.identity,
          meta: {
            umbrellaField,
            umbrellaPath,
            governance: { mode: umbrellaField.mode, decision: 'denied' },
          },
          error: {
            code: 'LANE_DENIED',
            message: 'Lane not admitted under the current umbrella field',
          },
        };
        emitTelemetry(failure as JsonObject);
        return resultResponse(failure, 403);
      }

      // Advance simulation state and identity
      this.simCoreState = stepSimCore(this.simCoreState as any, envelope.payload);
      const nextCurvature = computeIdentityCurvature(this.identityState, this.simCoreState);
      this.identityState = updateIdentityState(
        {
          ...(this.identityState ?? { subject: envelope.identity, curvature: nextCurvature }),
          subject: envelope.identity,
          curvature: nextCurvature,
        },
        [envelope.payload],
      ) as JsonObject;

      const actionContext: LaneExecutionContext = {
        identity: envelope.identity,
        governanceContext: envelope.governanceContext,
        planetaryMode: envelope.planetaryMode ?? 'single',
        umbrellaEnforcement: envelope.umbrellaEnforcement ?? 'strict',
        umbrellaMode: resolveUmbrellaMode(envelope.umbrellaEnforcement),
        identityCurvature: nextCurvature,
        entropyTick: Number((this.simCoreState as any).tick ?? 0),
        storage: this.createStorage(),
        env: {},
      };

      const kernelResult = await this.engine.dispatch(envelope);
      const collapseVector = computeCollapseVector(this.simCoreState, this.identityState);
      const patternIndex = indexPattern(envelope.payload, {
        type: envelope.type,
        identity: envelope.identity,
        planetaryMode: actionContext.planetaryMode,
        umbrellaMode: actionContext.umbrellaMode,
        lane: selectedLane,
      });

      const enrichedResult: KernelResult = {
        ...kernelResult,
        meta: {
          ...(kernelResult.meta ?? {}),
          identity: {
            state: this.identityState,
            curvature: nextCurvature,
            propagated: true,
          },
          planetaryMode: actionContext.planetaryMode,
          umbrellaEnforcement: actionContext.umbrellaEnforcement,
          umbrellaField,
          umbrellaPath,
          identityCurvature: nextCurvature,
          entropyTick: actionContext.entropyTick,
          simCore: this.simCoreState,
          collapseVector,
          patternIndex,
          governance: {
            mode: actionContext.umbrellaMode,
            decision: kernelResult.ok ? 'allowed' : 'denied',
            deltas: [],
          },
        },
      };

      this.resultHistory.push({
        ok: kernelResult.ok,
        processingTime: 0,
      });

      const brief = generateDailyBrief({
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        results: this.resultHistory,
        identity: envelope.identity,
        currentCurvature: nextCurvature,
        currentEntropy: Number((this.simCoreState as any).entropy ?? 0),
        governanceContext: envelope.governanceContext,
      });

      emitTelemetry(enrichedResult as JsonObject);
      if ('meta' in enrichedResult && enrichedResult.meta && typeof enrichedResult.meta === 'object') {
        (enrichedResult.meta as JsonObject).dailyBrief = brief;
      }

      return resultResponse(enrichedResult, kernelResult.ok ? 200 : 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kernel execution failed';
      const failure: KernelResult = {
        ok: false,
        messageId: 'portal-kernel-error',
        error: {
          code: 'PORTAL_KERNEL_ERROR',
          message,
        },
      };
      emitTelemetry(failure as JsonObject);
      return failureResponse('PORTAL_KERNEL_ERROR', message, 500);
    }
  }

  private initializeKernel(envelope: KernelEnvelope): void {
    this.simCoreState = initializeSimCore({
      identity: envelope.identity,
      governanceContext: envelope.governanceContext,
      planetaryMode: envelope.planetaryMode ?? 'single',
      umbrellaMode: envelope.umbrellaEnforcement ?? 'strict',
    });

    this.identityState = updateIdentityState(
      {
        subject: envelope.identity,
        curvature: 50,
      },
      [],
    ) as JsonObject;

    this.engine = new KernelEngine({
      identity: envelope.identity,
      governanceContext: envelope.governanceContext,
      planetaryMode: envelope.planetaryMode ?? 'single',
      umbrellaEnforcement: envelope.umbrellaEnforcement ?? 'strict',
      umbrellaMode: resolveUmbrellaMode(envelope.umbrellaEnforcement),
      identityCurvature: 50,
      entropyTick: 0,
      storage: this.createStorage(),
      env: {},
    });
  }

  private async parseEnvelope(request: Request): Promise<KernelEnvelope | null> {
    try {
      const body = await request.json();
      if (
        body &&
        typeof body === 'object' &&
        'id' in body &&
        'type' in body &&
        'payload' in body &&
        'identity' in body
      ) {
        return body as KernelEnvelope;
      }
      return null;
    } catch {
      return null;
    }
  }

  private createStorage(): DurableObjectStorage {
    const store = new Map<string, unknown>();
    return {
      async get<T>(key: string): Promise<T | undefined> {
        return (store.get(key) as T | undefined) ?? undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async deleteAll(): Promise<void> {
        store.clear();
      },
      async list(): Promise<Map<string, unknown>> {
        return new Map(store);
      },
      async getAlarm(): Promise<number | null> {
        return null;
      },
      async setAlarm(scheduledTimeMs: number): Promise<void> {
        void scheduledTimeMs;
      },
      async deleteAlarm(): Promise<void> {
        // noop
      },
      async sync(): Promise<void> {
        // noop
      },
    } as unknown as DurableObjectStorage;
  }
}
