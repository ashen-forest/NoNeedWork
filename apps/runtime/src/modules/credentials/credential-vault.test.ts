import { describe, expect, it } from "vitest";

import {
  CredentialVaultError,
  credentialEnvelopeSchema,
  decodeCredentialEnvelope,
  encodeCredentialEnvelope,
} from "./credential-vault.js";
import { FakeCredentialVault } from "./fake-credential-vault.js";

const now = new Date("2026-08-29T00:00:00.000Z");
const sentinel = "noneedwork-sentinel-secret";

describe("credential vault contract", () => {
  it("validates and round-trips a versioned credential envelope", () => {
    const encoded = encodeCredentialEnvelope(sentinel, now);
    expect(decodeCredentialEnvelope(encoded)).toEqual({
      schemaVersion: 1,
      secret: sentinel,
      updatedAt: now.toISOString(),
    });
    expect(credentialEnvelopeSchema.safeParse({ schemaVersion: 2, secret: sentinel }).success).toBe(
      false,
    );
  });

  it("overwrites, reports metadata, and deletes idempotently", () => {
    const vault = new FakeCredentialVault({ now: () => now });
    expect(vault.get("qwen-cn")).toBeUndefined();
    expect(vault.delete("qwen-cn")).toBe(false);

    vault.set("qwen-cn", sentinel);
    vault.set("qwen-cn", `${sentinel}-rotated`);
    expect(vault.get("qwen-cn")).toBe(`${sentinel}-rotated`);
    expect(vault.status("qwen-cn")).toEqual({
      profileId: "qwen-cn",
      configured: true,
      updatedAt: now.toISOString(),
    });
    expect(vault.delete("qwen-cn")).toBe(true);
    expect(vault.delete("qwen-cn")).toBe(false);
  });

  it("serializes status and recorded operations without secrets", () => {
    const vault = new FakeCredentialVault({ now: () => now });
    vault.set("minimax-cn", sentinel);

    expect(JSON.stringify(vault.listStatus())).not.toContain(sentinel);
    expect(JSON.stringify(vault.operations())).not.toContain(sentinel);
    expect(vault.operations()).toEqual([
      { operation: "write", profileId: "minimax-cn" },
      { operation: "read", profileId: "qwen-cn" },
      { operation: "read", profileId: "minimax-cn" },
    ]);
  });

  it("injects stable read, write, and delete failures", () => {
    const vault = new FakeCredentialVault();
    for (const operation of ["read", "write", "delete"] as const) {
      vault.failNext(operation);
      const invoke = () => {
        if (operation === "read") return vault.get("qwen-cn");
        if (operation === "write") return vault.set("qwen-cn", sentinel);
        return vault.delete("qwen-cn");
      };
      expect(invoke).toThrow(CredentialVaultError);
      try {
        invoke();
      } catch (error) {
        expect(String(error)).not.toContain(sentinel);
      }
    }
  });
});
