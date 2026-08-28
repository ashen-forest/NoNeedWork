import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeApp } from "./app.js";
import { createRuntimeConfig } from "./config.js";

const apps: ReturnType<typeof buildRuntimeApp>[] = [];
const token = "a".repeat(64);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp() {
  const app = buildRuntimeApp(
    createRuntimeConfig({
      launchToken: token,
      allowedOrigins: new Set(["tauri://localhost"]),
    }),
  );
  apps.push(app);
  return app;
}

const authorizedHeaders = {
  authorization: `Bearer ${token}`,
  "x-noneedwork-protocol": "1",
};

describe("local runtime API", () => {
  it("returns a versioned health response to an authenticated local client", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/v1/health",
      headers: authorizedHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      service: "noneedwork-runtime",
      status: "ready",
      engine: { name: "pi", version: "0.84.3", safeMode: true },
    });
  });

  it("rejects a missing launch token", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-noneedwork-protocol": "1" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an untrusted browser origin", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/v1/health",
      headers: { ...authorizedHeaders, origin: "https://evil.example" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("accepts the Tauri origin and handshake", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/v1/handshake",
      headers: { ...authorizedHeaders, origin: "tauri://localhost" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ protocolVersion: 1, accepted: true });
  });
});
