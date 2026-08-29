import { randomBytes, randomUUID } from "node:crypto";

import { Entry } from "@napi-rs/keyring";
import { describe, expect, it } from "vitest";

const enabled = process.platform === "win32" && process.env.NONEEDWORK_KEYRING_TESTS === "1";
const nativeDescribe = enabled ? describe : describe.skip;

nativeDescribe("native Windows Credential Manager", () => {
  it("round-trips and removes an isolated non-provider smoke entry", () => {
    const entry = new Entry(`NoNeedWork/test/${randomUUID()}`, "smoke");
    const value = randomBytes(24).toString("hex");
    try {
      entry.setPassword(value);
      expect(entry.getPassword()).toBe(value);
    } finally {
      entry.deletePassword();
    }
  });
});
