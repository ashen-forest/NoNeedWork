import type { ModelBlockReason } from "@noneedwork/protocol";

export interface NoNeedWorkProviderFailure {
  reason: ModelBlockReason;
  retryAfterMs?: number;
}

const QUOTA_CODES = new Set(["insufficient_quota", "quota_exhausted", "quota_exceeded"]);
const TRANSPORT_PATTERN =
  /\b(?:econnreset|econnrefused|etimedout|enotfound|socket hang up|fetch failed|network error|timed? ?out)\b/iu;
const PROTOCOL_PATTERN =
  /\b(?:invalid (?:json|sse|frame|protocol)|malformed|stream ended|finish_reason)\b/iu;

export function classifyNoNeedWorkProviderFailure(
  error: unknown,
  outputObserved: boolean,
): NoNeedWorkProviderFailure {
  if (outputObserved) return { reason: "UNKNOWN_MODEL_OUTCOME" };

  const status = readStatus(error);
  const message = readMessage(error).toLowerCase();
  const code = readCode(error)?.toLowerCase();
  const retryAfterMs = readRetryAfterMs(error);
  let reason: ModelBlockReason;

  if (status === 401 || status === 403) reason = "MODEL_AUTH_REJECTED";
  else if (status === 402 || (code !== undefined && QUOTA_CODES.has(code))) {
    reason = "MODEL_QUOTA_EXHAUSTED";
  } else if ([...QUOTA_CODES].some((quotaCode) => message.includes(quotaCode))) {
    reason = "MODEL_QUOTA_EXHAUSTED";
  } else if (status === 404) reason = "MODEL_UNAVAILABLE";
  else if (status === 429) reason = "MODEL_RATE_LIMITED";
  else if (status === 408 || (status !== undefined && status >= 500 && status <= 599)) {
    reason = "MODEL_TEMPORARILY_UNAVAILABLE";
  } else if (TRANSPORT_PATTERN.test(message)) reason = "MODEL_TEMPORARILY_UNAVAILABLE";
  else if (PROTOCOL_PATTERN.test(message)) reason = "MODEL_PROTOCOL_ERROR";
  else reason = "MODEL_PROTOCOL_ERROR";

  return {
    reason,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    const match = readMessage(error).match(
      /\b(?:status(?: code)?[:= ]*)?(401|402|403|404|408|429|5\d\d)\b/iu,
    );
    return match?.[1] ? Number(match[1]) : undefined;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
    cause?: unknown;
  };
  for (const value of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status,
    candidate.response?.statusCode,
  ]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return readStatus(candidate.cause ?? readMessage(error));
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; error?: { code?: unknown }; cause?: unknown };
  const code = candidate.code ?? candidate.error?.code;
  if (typeof code === "string") return code;
  return readCode(candidate.cause);
}

function readMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause === undefined ? error.message : `${error.message} ${readMessage(cause)}`;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; error?: { message?: unknown } };
    const values = [candidate.message, candidate.error?.message].filter(
      (value): value is string => typeof value === "string",
    );
    return values.join(" ");
  }
  return String(error ?? "");
}

function readRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    headers?: unknown;
    response?: { headers?: unknown };
    cause?: unknown;
  };
  const raw =
    readHeader(candidate.headers, "retry-after") ??
    readHeader(candidate.response?.headers, "retry-after");
  if (raw !== undefined) {
    const seconds = Number(raw);
    const value = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - Date.now();
    if (Number.isFinite(value) && value >= 0) {
      return Math.min(2_147_483_647, Math.round(value));
    }
  }
  return readRetryAfterMs(candidate.cause);
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && (typeof value === "string" || typeof value === "number")) {
      return String(value);
    }
  }
  return undefined;
}
