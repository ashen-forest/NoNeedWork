import { describe, expect, it } from "vitest";

import { redactSecrets } from "./secret-redactor.js";

const sentinel = "noneedwork-sentinel-secret";

describe("secret redactor", () => {
  it("replaces exact secrets in strings, errors, objects, and arrays", () => {
    const error = new Error(`provider rejected ${sentinel}`);
    const redacted = redactSecrets(
      {
        text: `prefix-${sentinel}-suffix`,
        nested: [sentinel, { error }],
      },
      [sentinel],
    );

    expect(JSON.stringify(redacted)).not.toContain(sentinel);
    expect(redacted).toEqual({
      text: "prefix-[REDACTED]-suffix",
      nested: [
        "[REDACTED]",
        { error: expect.objectContaining({ message: "provider rejected [REDACTED]" }) },
      ],
    });
  });

  it("does not treat empty strings as secrets or mutate its input", () => {
    const input = { value: sentinel };
    const redacted = redactSecrets(input, ["", sentinel]);
    expect(input.value).toBe(sentinel);
    expect(redacted).toEqual({ value: "[REDACTED]" });
  });
});
