import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyMigrations } from "./migrator.js";

export interface RuntimeDatabaseOptions {
  migrate?: boolean;
  busyTimeoutMs?: number;
}

export class RuntimeDatabase {
  readonly connection: DatabaseSync;

  constructor(
    readonly path: string,
    options: RuntimeDatabaseOptions = {},
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: options.busyTimeoutMs ?? 5_000,
    });
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec(`PRAGMA busy_timeout = ${String(options.busyTimeoutMs ?? 5_000)}`);
    this.connection.exec("PRAGMA trusted_schema = OFF");
    this.connection.exec("PRAGMA synchronous = FULL");
    if (path !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");

    const defensiveConnection = this.connection as DatabaseSync & {
      enableDefensive?: (active: boolean) => void;
    };
    defensiveConnection.enableDefensive?.(true);

    if (options.migrate !== false) applyMigrations(this.connection);
  }

  transaction<T>(work: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
