import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { backup } from "node:sqlite";

import type { RuntimeDatabase } from "./database.js";

export async function backupDatabase(
  database: RuntimeDatabase,
  destinationPath: string,
): Promise<number> {
  await mkdir(dirname(destinationPath), { recursive: true });
  return backup(database.connection, destinationPath);
}
