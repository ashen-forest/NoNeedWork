import type { DatabaseSync } from "node:sqlite";

import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./migrations/index.js";

interface VersionRow {
  version: number;
}

export function getSchemaVersion(database: DatabaseSync): number {
  const table = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
    .get();
  if (!table) return 0;
  const row = database.prepare("SELECT version FROM schema_meta WHERE singleton = 1").get() as
    | VersionRow
    | undefined;
  return row?.version ?? 0;
}

export function applyMigrations(database: DatabaseSync): number {
  const current = getSchemaVersion(database);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${current} is newer than supported schema ${LATEST_SCHEMA_VERSION}; rollback is refused`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL,
          migration_name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
      `);
      database
        .prepare(`
          INSERT INTO schema_meta(singleton, version, migration_name, applied_at)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            version = excluded.version,
            migration_name = excluded.migration_name,
            applied_at = excluded.applied_at
        `)
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Failed to apply migration ${migration.version}:${migration.name}`, {
        cause: error,
      });
    }
  }
  return LATEST_SCHEMA_VERSION;
}
