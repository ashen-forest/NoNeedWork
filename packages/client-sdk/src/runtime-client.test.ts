import { describe, expect, it, vi } from "vitest";

import { RuntimeClient, RuntimeClientError } from "./runtime-client.js";

describe("RuntimeClient", () => {
  it("sends the launch token and validates a health response", async () => {
    const fetch = vi.fn(
      async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${"a".repeat(64)}`);
        return Response.json({
          protocolVersion: 1,
          service: "noneedwork-runtime",
          status: "ready",
          version: "0.0.0",
          uptimeSeconds: 1,
          engine: { name: "pi", version: "0.84.3", safeMode: true },
        });
      },
    );
    const client = new RuntimeClient({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "a".repeat(64),
      fetch,
    });

    await expect(client.health()).resolves.toMatchObject({ status: "ready" });
  });

  it("rejects non-loopback endpoints", () => {
    expect(
      () => new RuntimeClient({ baseUrl: "https://example.com", bearerToken: "a".repeat(64) }),
    ).toThrow(/loopback/u);
  });

  it("preserves error status without trusting the response shape", async () => {
    const client = new RuntimeClient({
      baseUrl: "http://localhost:43123",
      bearerToken: "a".repeat(64),
      fetch: async () => Response.json({ arbitrary: true }, { status: 401 }),
    });

    await expect(client.health()).rejects.toBeInstanceOf(RuntimeClientError);
  });
});
