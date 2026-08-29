import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { readSecret, type SecretInput } from "./secret-reader.js";

function terminalFixture() {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode(value: boolean): void;
    resume(): void;
    pause(): void;
  };
  input.isTTY = true;
  input.isRaw = false;
  const rawModes: boolean[] = [];
  input.setRawMode = (value) => {
    rawModes.push(value);
    input.isRaw = value;
  };
  input.resume = vi.fn();
  input.pause = vi.fn();
  let rendered = "";
  const output = {
    isTTY: true,
    write(value: string) {
      rendered += value;
      return true;
    },
  };
  return {
    input: input as unknown as SecretInput["input"],
    output: output as SecretInput["output"],
    rawModes,
    rendered: () => rendered,
  };
}

describe("readSecret", () => {
  it("captures hidden TTY input and restores raw mode", async () => {
    const terminal = terminalFixture();
    const pending = readSecret("Credential: ", terminal);
    terminal.input.emit("data", Buffer.from("noneedwork-sentinel-secret\r"));

    await expect(pending).resolves.toBe("noneedwork-sentinel-secret");
    expect(terminal.rawModes).toEqual([true, false]);
    expect(terminal.rendered()).toBe("Credential: \n");
    expect(terminal.rendered()).not.toContain("sentinel");
  });

  it("restores terminal state after cancellation", async () => {
    const terminal = terminalFixture();
    const pending = readSecret("Credential: ", terminal);
    terminal.input.emit("data", Buffer.from([3]));

    await expect(pending).rejects.toThrow("cancelled");
    expect(terminal.rawModes).toEqual([true, false]);
  });

  it("rejects redirected input", async () => {
    const terminal = terminalFixture();
    Object.defineProperty(terminal.input, "isTTY", { value: false });
    await expect(readSecret("Credential: ", terminal)).rejects.toThrow("interactive TTY");
  });
});
