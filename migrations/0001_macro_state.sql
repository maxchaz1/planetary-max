CREATE TABLE IF NOT EXISTS maxos_state (
  key TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS macro_state_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  planetary_mode TEXT NOT NULL,
  umbrella_status TEXT NOT NULL,
  active_nodes INTEGER NOT NULL,
  mesh_telemetry_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS micro_telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifold TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_time ON macro_state_snapshots(created_at);
