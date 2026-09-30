"""Read-only introspection dispatch with explicit connectivity boundaries."""
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict


class IntrospectionKind(Enum):
    SIM_BEHAVIOR = "sim.behavior"
    IDENTITY_TIMELINE = "identity.timeline"
    WINDOWS_FOCUS = "windows.focus"
    UMBRELLA_ENFORCEMENT = "umbrella.enforcement"
    KERNEL_HEATMAP = "kernel.heatmap"
    TEC_PIPELINE = "tec.pipeline"
    SUBSTRATE_STATE = "substrate.state"
    MESSAGES = "messages"
    LOGS = "logs"
    INFERENCE = "inference"


@dataclass
class IntrospectionQuery:
    kind: IntrospectionKind
    filters: Dict[str, Any]
    limit: int = 100
    offset: int = 0


class IntrospectionLayer:
    def __init__(self, substrate: Any = None, governance: Any = None, sim: Any = None):
        self.substrate = substrate
        self.governance = governance
        self.sim = sim
        self.queries: Dict[str, IntrospectionQuery] = {}

    def handle_introspection(self, kind: str, filters: Dict[str, Any], limit: int = 100, offset: int = 0) -> Dict[str, Any]:
        try:
            query_kind = IntrospectionKind(kind)
        except ValueError:
            return {"ok": False, "error": {"code": "INVALID_INTROSPECTION_KIND", "message": f"Unknown introspection kind: {kind}"}}
        if not isinstance(filters, dict) or not isinstance(limit, int) or isinstance(limit, bool) or not 0 <= limit <= 1000 or not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            return {"ok": False, "error": {"code": "INVALID_INTROSPECTION_QUERY", "message": "Invalid introspection query"}}
        if query_kind == IntrospectionKind.SIM_BEHAVIOR:
            return {"ok": True, "data": self._sim_snapshot()}
        if query_kind == IntrospectionKind.SUBSTRATE_STATE:
            return {"ok": True, "data": self._substrate_snapshot()}
        if query_kind == IntrospectionKind.UMBRELLA_ENFORCEMENT:
            return {"ok": True, "data": self._governance_snapshot()}
        return {"ok": True, "data": {"status": "not_connected", "kind": kind, "connected": False}}

    def _sim_value(self, name: str, default: Any = None) -> Any:
        if self.sim is None:
            return default
        if isinstance(self.sim, dict):
            return self.sim.get(name, default)
        return getattr(self.sim, name, default)

    def _sim_snapshot(self) -> Dict[str, Any]:
        return {
            "mode": self._sim_value("mode", "off"),
            "lastOp": self._sim_value("last_op"),
            "lastCalc": self._sim_value("last_calc"),
            "lastMap": self._sim_value("last_map"),
            "lastPipe": self._sim_value("last_pipe"),
            "lastExpand": self._sim_value("last_expand"),
            "lastBuild": self._sim_value("last_build"),
            "global": self._sim_value("global_state", {}),
            "status": "connected",
        }

    def _substrate_snapshot(self) -> Dict[str, Any]:
        if self.substrate is None:
            return {"status": "not_connected", "kind": "substrate.state", "connected": False}
        state = self.substrate() if callable(self.substrate) else self.substrate
        return {"do_state": state, "kv_state": {}, "coherence_status": "consistent", "last_transaction": None, "connected": True}

    def _governance_snapshot(self) -> Dict[str, Any]:
        mode = getattr(self.governance, "mode", None) or (self.governance.get("mode") if isinstance(self.governance, dict) else "strict")
        return {"enforcement_mode": mode, "decision": "allowed", "rule_evaluations": [], "denials": [], "connected": True}
