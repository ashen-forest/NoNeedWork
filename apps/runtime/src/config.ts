import { randomBytes } from "node:crypto";
import { join } from "node:path";

export interface RuntimeConfig {
  host: "127.0.0.1";
  port: number;
  launchToken: string;
  allowedOrigins: ReadonlySet<string>;
  appDataDirectory: string;
  version: string;
}

export function createRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const localAppData = process.env.LOCALAPPDATA ?? join(process.cwd(), ".noneedwork-data");
  return {
    host: "127.0.0.1",
    port: 0,
    launchToken: randomBytes(32).toString("hex"),
    allowedOrigins: new Set([
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ]),
    appDataDirectory: join(localAppData, "NoNeedWork"),
    version: "0.0.0",
    ...overrides,
  };
}
