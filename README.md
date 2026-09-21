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

The Hono Worker is the only public entrypoint. It validates the GUI bearer
token, builds the shared envelope, and calls the `PortalKernel` Durable Object
through `callKernel()`. The Durable Object owns the lane registry and persists
SIM, substrate, and universe state in Durable Object storage.

The shared envelope is:

```json
{
  "id": "message-123",
  "type": "sim",
  "payload": { "observation": "stable" },
  "identity": "bearer-token",
  "governanceContext": {}
}
```

Successful kernel responses expose aligned `lanes`, `results`, and `output`
fields. GUI routes normalize `output` into `{ ok, data, meta }`.

OS-level messages use an `os.` prefix, for example `os.identity`. When
`MAX_OS_1` or `MAXOS_URL` is configured, `callKernel()` adapts and forwards
those envelopes to MAX-OS-1 at `/kernel/message`. The explicit
`POST /os/kernel/message` route provides the same authenticated bridge for
callers that do not use an `os.*` type. MAX-OS-1 is never called by the GUI
directly, and MAX-OS-1 does not call planetary-max.

The Durable Object binding and its SQLite migration are declared in
`wrangler.toml`. Deploy them together with:

```bash
npm test
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy
```

## Development

### Testing Invariants
```bash
python -c "from kernel.invariants import InvariantChecker; InvariantChecker().check_all()"
```

### Rebuild 2 Integration

```bash
python tests/integration_rebuild2.py
npm test
npm run check
```

## Status

- **Rebuild 2**: Complete
- **Architecture**: Defined
- **Core Modules**: Initialized
- **Next Phase**: Configure the optional MAX-OS-1 service binding in each Cloudflare environment

---

**Last Updated**: 2026-08-27  
**Rebuild Phase**: 2  
**Status**: Integrated architecture foundation
