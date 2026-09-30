"""Dispatch read-only introspection envelopes to the kernel introspection layer."""
from typing import Any, Dict
from kernel.introspection import IntrospectionLayer

_INTROSPECTION_PREFIX = "introspection."

def handle_introspection(envelope: Dict[str, Any], layer: IntrospectionLayer) -> Dict[str, Any]:
    if not isinstance(envelope, dict):
        raise ValueError("introspection envelope must be an object")
    message_type = envelope.get("type", "")
    if not isinstance(message_type, str) or not message_type.startswith(_INTROSPECTION_PREFIX):
        raise ValueError("introspection envelope must include a valid type")
    payload = envelope.get("payload", {})
    if not isinstance(payload, dict):
        raise ValueError("introspection payload must be an object")
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    offset = payload.get("offset", 0)
    return layer.handle_introspection(message_type[len(_INTROSPECTION_PREFIX):], filters if isinstance(filters, dict) else {}, limit=limit, offset=offset)
