export const INITIAL_SCHEMA_SQL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  current_run_id TEXT,
  budget_json TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX tasks_project_idx ON tasks(project_id, created_at);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  pi_session_id TEXT,
  pi_session_file TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  checkpoint_json TEXT,
  replan_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;
CREATE INDEX task_runs_task_idx ON task_runs(task_id, created_at);
CREATE INDEX task_runs_recovery_idx ON task_runs(status, lease_expires_at);

CREATE TABLE plan_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  objective TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  allowed_paths_json TEXT NOT NULL,
  verification_commands_json TEXT NOT NULL,
  requires_write INTEGER NOT NULL CHECK (requires_write IN (0, 1)),
  status TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  result_artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, position)
) STRICT;
CREATE INDEX plan_steps_ready_idx ON plan_steps(run_id, status, position);

CREATE TABLE run_events (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(run_id, sequence)
) STRICT, WITHOUT ROWID;

CREATE TABLE tool_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  tool_call_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  args_json TEXT NOT NULL,
  state TEXT NOT NULL,
  sandbox_operation_id TEXT,
  result_artifact_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, tool_call_id)
) STRICT;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  resource_json TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sandboxes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES task_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  workspace_json TEXT NOT NULL,
  resource_profile_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  destroyed_at TEXT
) STRICT;

CREATE TABLE worker_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  parent_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  pi_session_id TEXT,
  budget_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  name TEXT NOT NULL,
  producer TEXT NOT NULL,
  retention TEXT NOT NULL,
  filesystem_path TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX artifacts_run_idx ON artifacts(run_id, created_at);
CREATE INDEX artifacts_hash_idx ON artifacts(sha256);

CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  suite TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE eval_results (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(eval_run_id, case_id)
) STRICT;
`;
