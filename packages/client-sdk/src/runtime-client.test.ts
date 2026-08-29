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

  it("implements the typed model control plane", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    const fetch = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        requests.push({
          path,
          method: init?.method ?? "GET",
          ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
        });
        if (path.endsWith("/profiles")) {
          return Response.json({
            profiles: [
              {
                profileId: "qwen-cn",
                displayName: "Qwen Token Plan CN",
                defaultModelId: "qwen3.7-plus",
                modelIds: ["qwen3.7-plus"],
                capabilities: { text: true, thinking: true, toolCalls: true, images: false },
              },
              {
                profileId: "minimax-cn",
                displayName: "MiniMax Token Plan CN",
                defaultModelId: "MiniMax-M3",
                modelIds: ["MiniMax-M3"],
                capabilities: { text: true, thinking: true, toolCalls: true, images: false },
              },
            ],
          });
        }
        if (path.endsWith("/selection")) {
          return Response.json({ profileId: "minimax-cn", modelId: "MiniMax-M3" });
        }
        if (path.endsWith("/credentials")) return Response.json({ credentials: [] });
        if (path.includes("/credentials/")) {
          return Response.json({
            profileId: "minimax-cn",
            configured: init?.method !== "DELETE",
            updatedAt: init?.method === "DELETE" ? null : "2026-08-29T00:00:00.000Z",
          });
        }
        return Response.json({
          profileId: "minimax-cn",
          modelId: "MiniMax-M3",
          success: true,
          latencyMs: 1,
          checks: { text: true, toolCall: true },
        });
      },
    );
    const client = new RuntimeClient({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "a".repeat(64),
      fetch,
    });

    await client.listModelProfiles();
    await client.getModelSelection();
    await client.setModelSelection({ profileId: "minimax-cn", modelId: "MiniMax-M3" });
    await client.listModelCredentials();
    await client.setModelCredential("minimax-cn", "noneedwork-sentinel-secret");
    await client.deleteModelCredential("minimax-cn");
    await client.probeModel("minimax-cn");

    expect(requests.map(({ path, method }) => [path, method])).toEqual([
      ["/v1/models/profiles", "GET"],
      ["/v1/models/selection", "GET"],
      ["/v1/models/selection", "PUT"],
      ["/v1/models/credentials", "GET"],
      ["/v1/models/credentials/minimax-cn", "PUT"],
      ["/v1/models/credentials/minimax-cn", "DELETE"],
      ["/v1/models/probe/minimax-cn", "POST"],
    ]);
  });

  it("does not retain a sensitive request or reflected error body", async () => {
    const sentinel = "noneedwork-sentinel-secret";
    const client = new RuntimeClient({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "a".repeat(64),
      fetch: async () => Response.json({ reflected: sentinel }, { status: 500 }),
    });

    let captured: unknown;
    try {
      await client.setModelCredential("qwen-cn", sentinel);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(RuntimeClientError);
    expect(captured).toMatchObject({ body: undefined });
    expect(JSON.stringify({ client, error: captured })).not.toContain(sentinel);
  });
});
