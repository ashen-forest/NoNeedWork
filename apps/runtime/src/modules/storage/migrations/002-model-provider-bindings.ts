export const MODEL_PROVIDER_BINDINGS_SCHEMA_SQL = `
CREATE TABLE model_preferences (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE task_run_models (
  run_id TEXT PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  pi_provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  pi_sdk_version TEXT NOT NULL,
  selection_source TEXT NOT NULL CHECK (selection_source IN ('default', 'task_override')),
  created_at TEXT NOT NULL
) STRICT;
`;
