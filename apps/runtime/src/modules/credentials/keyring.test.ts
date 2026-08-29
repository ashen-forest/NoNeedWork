import { describe, expect, it } from "vitest";

import { CredentialVaultError, encodeCredentialEnvelope } from "./credential-vault.js";
import { KeyringCredentialVault, type KeyringEntry } from "./keyring.js";

const sentinel = "noneedwork-sentinel-secret";
const now = new Date("2026-08-29T00:00:00.000Z");

class FakeEntry implements KeyringEntry {
  value: string | null = null;
  readError?: unknown;
  writeError?: unknown;
  deleteError?: unknown;

  setPassword(value: string): void {
    if (this.writeError) throw this.writeError;
    this.value = value;
  }

  getPassword(): string | null {
    if (this.readError) throw this.readError;
    return this.value;
  }

  deletePassword(): boolean {
    if (this.deleteError) throw this.deleteError;
    const deleted = this.value !== null;
    this.value = null;
    return deleted;
  }
}

describe("KeyringCredentialVault", () => {
  it("uses the fixed service and profile account and handles a missing entry", () => {
    const entries = new Map<string, FakeEntry>();
    const vault = new KeyringCredentialVault({
      now: () => now,
      entryFactory: (service, account) => {
        expect(service).toBe("NoNeedWork/model-provider");
        const entry = new FakeEntry();
        entries.set(account, entry);
        return entry;
      },
    });

    expect(vault.get("qwen-cn")).toBeUndefined();
    vault.set("qwen-cn", sentinel);
    expect(vault.get("qwen-cn")).toBe(sentinel);
    expect(entries.get("qwen-cn")?.value).toBe(encodeCredentialEnvelope(sentinel, now));
  });

  it("maps only a native NoEntry code to missing", () => {
    const entry = new FakeEntry();
    entry.readError = Object.assign(new Error("missing native entry"), { code: "NoEntry" });
    const vault = new KeyringCredentialVault({ entryFactory: () => entry });
    expect(vault.get("qwen-cn")).toBeUndefined();
  });

  it("rejects corrupt envelopes and hides native error messages", () => {
    const entry = new FakeEntry();
    const vault = new KeyringCredentialVault({ entryFactory: () => entry });
    entry.value = "not-json";
    expect(() => vault.get("qwen-cn")).toThrow(CredentialVaultError);

    entry.readError = new Error(`native denied ${sentinel}`);
    try {
      vault.get("qwen-cn");
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
      expect(error).toMatchObject({ code: "CREDENTIAL_READ_FAILED" });
    }
  });

  it("wraps write and delete failures without native details", () => {
    const entry = new FakeEntry();
    const vault = new KeyringCredentialVault({ entryFactory: () => entry });
    entry.writeError = new Error(`write denied ${sentinel}`);
    expect(() => vault.set("qwen-cn", sentinel)).toThrow("Credential write failed");
    entry.writeError = undefined;
    entry.deleteError = new Error(`delete denied ${sentinel}`);
    expect(() => vault.delete("qwen-cn")).toThrow("Credential delete failed");
  });
});
