"""Portal-OS kernel boot sequence and one-message JSON entrypoint."""

import argparse
import json
import logging
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Optional

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from governance.engine import GovernanceEngine
from identity.registry import IdentityError, IdentityRegistry
from kernel.introspection import IntrospectionLayer
from kernel.introspection_dispatch import handle_introspection
from kernel.invariants import InvariantChecker
from kernel.scheduler import MultiDomainScheduler
from routing.router import Router, RoutingError

LOGGER = logging.getLogger("portal.kernel")


class KernelPhase(Enum):
    INVARIANTS = "invariants"
    MODULES = "modules"
    SCHEDULER = "scheduler"
    GOVERNANCE = "governance"
    IDENTITY = "identity"
    READY = "ready"


@dataclass
class KernelState:
    phase: KernelPhase = KernelPhase.INVARIANTS
    invariants: Dict[str, Any] = field(default_factory=dict)
    modules: Dict[str, Any] = field(default_factory=dict)
    scheduler_ready: bool = False
    governance_ready: bool = False
    identity_ready: bool = False


class Kernel:
    """Own and connect every Rebuild 2 kernel subsystem."""

    def __init__(self, identity_registry: Optional[IdentityRegistry] = None) -> None:
        self.state = KernelState()
        self.invariant_checker = InvariantChecker()
        self.identity_registry = identity_registry
        self.governance: Optional[GovernanceEngine] = None
        self.scheduler: Optional[MultiDomainScheduler] = None
        self.router: Optional[Router] = None
        self.introspection = IntrospectionLayer()

    def load_invariants(self) -> None:
        self.state.phase = KernelPhase.INVARIANTS
        if not self.invariant_checker.check_all():
            raise RuntimeError("kernel invariants failed during boot")
        self.state.invariants = {
            "messageMaxAgeMs": 30000,
            "schedulerCycleMs": 100,
            "schedulerMaxSteps": 16,
            "identityRequired": True,
            "authorizationRequired": True,
        }
        LOGGER.info("invariants loaded")

    def load_modules(self) -> None:
        self.state.phase = KernelPhase.MODULES
        self.state.modules = {
            "routing": "routing.router.Router",
            "cognitive": "cognitive.core.SIMCore",
            "tec": "tec.pipelines.TECPipeline",
            "substrate": "substrate.state_model.SubstrateState",
            "maxos": "maxos_bridge.universe",
            "introspection": "kernel.introspection.IntrospectionLayer",
        }
        LOGGER.info("modules loaded count=%d", len(self.state.modules))

    def start_scheduler(self) -> None:
        self.state.phase = KernelPhase.SCHEDULER
        self.scheduler = MultiDomainScheduler(
            cycle_ms=self.state.invariants["schedulerCycleMs"],
            max_steps=self.state.invariants["schedulerMaxSteps"],
        )
        self.state.scheduler_ready = True
        LOGGER.info("scheduler initialized")

    def register_governance(self) -> None:
        self.state.phase = KernelPhase.GOVERNANCE
        self.governance = GovernanceEngine()
        self.state.governance_ready = True
        LOGGER.info("governance registered")

    def register_identity(self) -> None:
        self.state.phase = KernelPhase.IDENTITY
        if self.identity_registry is None:
            self.identity_registry = IdentityRegistry()
        if self.governance is None:
            raise RuntimeError("governance must be registered before identity routing")
        self.router = Router(self.identity_registry, self.governance)
        self.state.identity_ready = True
        LOGGER.info("identity registered")

    def boot(self) -> KernelState:
        if self.state.phase == KernelPhase.READY:
            return self.state
        self.load_invariants()
        self.load_modules()
        self.start_scheduler()
        self.register_governance()
        self.register_identity()
        if not all((self.state.scheduler_ready, self.state.governance_ready, self.state.identity_ready, self.router)):
            raise RuntimeError("kernel boot incomplete")
        self.state.phase = KernelPhase.READY
        LOGGER.info("kernel ready")
        return self.state

    def handle_message(self, envelope: Dict[str, Any]) -> Dict[str, Any]:
        if self.state.phase != KernelPhase.READY:
            self.boot()
        try:
            self._validate_envelope(envelope)
            if not self.invariant_checker.check_all():
                raise RuntimeError("pre-schedule invariant validation failed")
            assert self.router is not None
            assert self.scheduler is not None
            decision = self.router.route(envelope)
            routed = dict(envelope)
            routed["_route"] = list(decision.lanes)
            routed["_sequence"] = self.router.sequence
            routed["_identity"] = decision.identity.as_dict()

            if envelope["type"].startswith("introspection."):
                result = handle_introspection(envelope, self.introspection)
            else:
                result = self.scheduler.schedule(routed)

            self._validate_runtime_invariants()
            return {
                "ok": True,
                "messageId": envelope["id"],
                "type": envelope["type"],
                "identity": decision.identity.as_dict(),
                "route": list(decision.lanes),
                "result": result,
            }
        except IdentityError as error:
            LOGGER.warning("identity rejected message=%s reason=%s", envelope.get("id"), error)
            return self._error(envelope, "UNAUTHENTICATED", str(error))
        except PermissionError as error:
            LOGGER.warning("governance rejected message=%s reason=%s", envelope.get("id"), error)
            return self._error(envelope, "FORBIDDEN", str(error))
        except (RoutingError, ValueError) as error:
            LOGGER.warning("message rejected message=%s reason=%s", envelope.get("id"), error)
            return self._error(envelope, "INVALID_MESSAGE", str(error))
        except (RuntimeError, TimeoutError) as error:
            LOGGER.error("kernel invariant failure message=%s reason=%s", envelope.get("id"), error)
            return self._error(envelope, "INVARIANT_VIOLATION", str(error))
        except Exception as error:
            LOGGER.exception("kernel message failure message=%s", envelope.get("id"))
            return self._error(envelope, "KERNEL_ERROR", str(error))

    def _validate_envelope(self, envelope: Dict[str, Any]) -> None:
        if not isinstance(envelope, dict):
            raise ValueError("message envelope must be an object")
        required = ("id", "type", "payload", "identity", "governanceContext")
        missing = [field for field in required if field not in envelope]
        if missing:
            raise ValueError(f"message envelope missing: {', '.join(missing)}")
        if not isinstance(envelope["id"], str) or not envelope["id"]:
            raise ValueError("message id must be a non-empty string")
        if not isinstance(envelope["payload"], dict):
            raise ValueError("message payload must be an object")
        if not isinstance(envelope["governanceContext"], dict):
            raise ValueError("governanceContext must be an object")

    def _validate_runtime_invariants(self) -> None:
        assert self.scheduler is not None
        checks = {
            "SIM Trajectory Valid": self.scheduler.sim_trajectory.is_valid(),
            "Substrate Consistent": self.scheduler.substrate.is_consistent(),
            "KV Eventual Consistency": self.scheduler.substrate.kv_eventually_consistent(),
        }
        failures = [name for name, valid in checks.items() if not valid]
        if failures:
            raise RuntimeError(f"runtime invariant violation: {', '.join(failures)}")

    @staticmethod
    def _error(envelope: Dict[str, Any], code: str, message: str) -> Dict[str, Any]:
        return {"ok": False, "messageId": envelope.get("id"), "error": {"code": code, "message": message}}


KernelBoot = Kernel
_KERNEL = Kernel()


def handle_message(envelope: Dict[str, Any]) -> Dict[str, Any]:
    """Process one authorized Worker envelope through the complete kernel."""
    return _KERNEL.handle_message(envelope)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Boot Portal-OS or process one JSON message")
    parser.add_argument("--message", action="store_true", help="read one envelope from stdin and write one JSON response")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s", stream=sys.stderr)
    if args.message:
        try:
            envelope = json.load(sys.stdin)
        except (json.JSONDecodeError, OSError) as error:
            print(json.dumps({"ok": False, "error": {"code": "INVALID_JSON", "message": str(error)}}))
            return 2
        print(json.dumps(handle_message(envelope), sort_keys=True, separators=(",", ":")))
        return 0
    state = _KERNEL.boot()
    print(f"Final state: {state.phase.value}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
