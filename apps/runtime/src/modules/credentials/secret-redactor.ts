const REDACTED = "[REDACTED]";

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (redacted, secret) => (secret.length === 0 ? redacted : redacted.split(secret).join(REDACTED)),
    value,
  );
}

export function redactSecrets(value: unknown, rawSecrets: readonly string[]): unknown {
  const secrets = [...new Set(rawSecrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  if (secrets.length === 0) return value;
  return redactValue(value, secrets);
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (value instanceof Error) {
    return {
      name: redactString(value.name, secrets),
      message: redactString(value.message, secrets),
      ...(value.stack ? { stack: redactString(value.stack, secrets) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, secrets)]),
    );
  }
  return value;
}
