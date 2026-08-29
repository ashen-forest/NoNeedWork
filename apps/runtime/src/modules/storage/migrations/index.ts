import { INITIAL_SCHEMA_SQL } from "./001-initial.js";
import { MODEL_PROVIDER_BINDINGS_SCHEMA_SQL } from "./002-model-provider-bindings.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial", sql: INITIAL_SCHEMA_SQL },
  { version: 2, name: "model-provider-bindings", sql: MODEL_PROVIDER_BINDINGS_SCHEMA_SQL },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
