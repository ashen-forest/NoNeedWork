import { describe, expect, it } from "vitest";

import { classifyNoNeedWorkProviderFailure } from "./provider-errors.js";

describe("provider failure classification", () => {
  it.each([
    [401, "MODEL_AUTH_REJECTED"],
    [403, "MODEL_AUTH_REJECTED"],
    [402, "MODEL_QUOTA_EXHAUSTED"],
    [404, "MODEL_UNAVAILABLE"],
    [429, "MODEL_RATE_LIMITED"],
    [408, "MODEL_TEMPORARILY_UNAVAILABLE"],
    [500, "MODEL_TEMPORARILY_UNAVAILABLE"],
    [503, "MODEL_TEMPORARILY_UNAVAILABLE"],
  ])("maps HTTP %s to %s", (status, reason) => {
    expect(classifyNoNeedWorkProviderFailure({ status }, false)).toMatchObject({ reason });
  });

  it("allowlists explicit quota and transport signals", () => {
    expect(classifyNoNeedWorkProviderFailure("insufficient_quota", false)).toMatchObject({
      reason: "MODEL_QUOTA_EXHAUSTED",
    });
    expect(classifyNoNeedWorkProviderFailure(new Error("ECONNRESET"), false)).toMatchObject({
      reason: "MODEL_TEMPORARILY_UNAVAILABLE",
    });
  });

  it("treats every failure after model output as unknown outcome", () => {
    expect(classifyNoNeedWorkProviderFailure({ status: 429 }, true)).toEqual({
      reason: "UNKNOWN_MODEL_OUTCOME",
    });
  });

  it("returns a bounded retry-after value without reflecting raw errors", () => {
    expect(
      classifyNoNeedWorkProviderFailure(
        { status: 429, headers: { "retry-after": "2" }, message: "sensitive body" },
        false,
      ),
    ).toEqual({ reason: "MODEL_RATE_LIMITED", retryAfterMs: 2_000 });
  });
});
