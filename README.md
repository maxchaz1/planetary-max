# Portal-OS — Rebuild 2

**Integrated Operating System Architecture**

> Rebuild 1 proved the system works.  
> Rebuild 2 makes the system whole.

Portal-OS is a distributed operating system built on Cloudflare Workers, with a kernel written in Python and a cognitive architecture built on SIM (Symbolic Intelligent Model).

## Structure

```
src/
  ├── index.ts                    # Cloudflare Workers entrypoint (Hono)
kernel/
  ├── boot.py                     # Kernel initialization
  ├── scheduler.py                # Multi-domain scheduler
  ├── invariants.py               # System invariants
  └── [modules]/                  # Kernel subsystems
identity/                          # Identity & authentication
governance/                        # Rules & policies
routing/                          # Message routing
orchestration/                    # Task orchestration
tec/                              # TEC execution layer
cognitive/                        # SIM cognitive architecture
```

## Rebuild 2 — What It Is

Rebuild 2 is the **integration rebuild** — the phase where Portal-OS transforms from a set of working components into a **unified, internally coherent operating system**.

### Purpose

Transform Rebuild 1's successful deploy state into a fully integrated Portal-OS architecture where every subsystem is wired together into a single deterministic runtime.

### Key Additions

1. **Worker → Kernel Bridge** — Message bridge between Worker entrypoint and Kernel boot
2. **Kernel Initialization Sequence** — Formalizes invariants, module loading, scheduler startup, governance + identity registration
3. **Multi-Domain Scheduler** — Cognitive, orchestration, substrate, and governance lanes
4. **SIM Cognitive Wiring** — Kernel → SIM integration (Core, State, Trajectory, Compute)
5. **TEC Execution Layer** — Pipelines, agents, surfaces, governance hooks
6. **Identity + Governance Enforcement** — Wired into routing, orchestration, kernel invariants
7. **Routing Table** — Deterministic routing from Worker → Kernel → SIM → TEC → Substrate → Worker
8. **Substrate State Model** — DO state, KV persistence, substrate invariants

## Rebuild 2 — Build Order

1. ✓ Worker → Kernel bridge
2. ✓ Kernel boot + invariants
3. ✓ Scheduler domain lanes
4. ✓ SIM wiring
5. ✓ TEC pipelines
6. ✓ Identity + governance
7. ✓ Routing table
8. ✓ Substrate state model
9. ✓ MAX-OS-1 universe adapter
10. ✓ Full integration test

## System Invariants

Portal-OS maintains these invariants across all layers:

### Tier 1: Foundational
- **State Coherence** — System state must be consistent across all layers
- **No Silent Failures** — Every failure must be logged and escalated

### Tier 2: Security
- **Authorization Enforced** — Every operation must be authorized
- **Identity Established** — Every message must carry valid identity

### Tier 3: Messaging
- **Message Ordering** — Intra-domain ordering is strict
- **No Message Loss** — Every message is processed or explicitly rejected
- **Message Timeout** — Messages have bounded age

### Tier 4: Concurrency
- **Scheduler Cycles Complete** — Cycles complete within bounded time
- **No Deadlock** — Lanes never deadlock each other

### Tier 5: Substrate
- **Substrate Consistent** — DO + KV state synchronized
- **KV Eventual Consistency** — System handles eventual consistency gracefully

### Tier 6: Execution
- **SIM Trajectory Valid** — SIM state trajectory is always valid
- **TEC Execution Bounded** — TEC agents complete within bounded time

## Getting Started

### Prerequisites
- Python 3.9+
- Node.js 18+
- Cloudflare Workers account

### Running Kernel Boot
```bash
python kernel/boot.py
```

This will execute the full boot sequence:
1. Load invariants
2. Load modules
3. Start scheduler
4. Register governance
5. Register identity

### Worker and Kernel Bridge

Cloudflare Workers cannot start local subprocesses. Deploy the Python adapter
behind the `portal-kernel` Worker and connect it through the required
`KERNEL_SERVICE` service binding. The Portal-OS Worker enforces identity and
governance, dispatches envelopes through the declarative MAX-OS-1 lane router,
persists deterministic lane state through the `MAXOS_STATE` R2 binding, and
sends the orchestrated envelope to that binding. Identity metadata is
structurally checked at the edge; the kernel remains authoritative for
credential verification. The Worker does not define local demo routes. For
local adapter development:

Phase 11 adds deterministic request tracing, structured JSON logs, no-op-safe
metrics, bounded kernel/substrate retries and timeouts, and a kernel circuit
breaker. Runtime limits are configured through the timeout, retry, and circuit
variables in `wrangler.toml`.

```bash
python kernel/http_adapter.py --port 8788
```

The one-message synchronous bridge is also available directly:

```bash
export PORTAL_SERVICE_TOKEN="a-locally-generated-secret"
printf '%s' '{"id":"demo","type":"sim","payload":{},"identity":"a-locally-generated-secret","governanceContext":{}}' \
  | python kernel/boot.py --message
```

Identity tokens are loaded from `PORTAL_SYSTEM_TOKEN`, `PORTAL_SERVICE_TOKEN`,
and `PORTAL_OBSERVER_TOKEN`; there are no built-in production credentials.

Set `MAXOS_MODULE` to the installed MAX-OS-1 Python module exporting
`MaxOsUnifiedOrchestrator`. Without it, a deterministic in-memory universe is
used for local development and integration tests.

## Development

### Testing Invariants
```bash
python -c "from kernel.invariants import InvariantChecker; InvariantChecker().check_all()"
```

### Rebuild 2 Integration

```bash
python tests/integration_rebuild2.py
npm run check
```

## Status

- **Rebuild 2**: Complete
- **Architecture**: Defined
- **Core Modules**: Initialized
- **Next Phase**: Deploy the Python adapter and connect the external MAX-OS-1 package

---

**Last Updated**: 2026-08-27  
**Rebuild Phase**: 2  
**Status**: Integrated architecture foundation
