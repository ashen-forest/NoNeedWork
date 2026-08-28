import { INITIAL_SCHEMA_SQL } from "./001-initial.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial", sql: INITIAL_SCHEMA_SQL },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
