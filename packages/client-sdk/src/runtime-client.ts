import {
  PROTOCOL_VERSION,
  type RuntimeHandshakeResponse,
  type RuntimeHealth,
  runtimeHandshakeResponseSchema,
  runtimeHealthSchema,
} from "@noneedwork/protocol";

export interface RuntimeClientOptions {
  baseUrl: string;
  bearerToken: string;
  fetch?: typeof globalThis.fetch;
}

export class RuntimeClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "RuntimeClientError";
    this.status = status;
    this.body = body;
  }
}

export class RuntimeClient {
  readonly #baseUrl: URL;
  readonly #bearerToken: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RuntimeClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!isLoopback(this.#baseUrl.hostname)) {
      throw new Error("NoNeedWork RuntimeClient only accepts loopback endpoints");
    }
    this.#bearerToken = options.bearerToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  health(): Promise<RuntimeHealth> {
    return this.#request("/v1/health", runtimeHealthSchema);
  }

  handshake(): Promise<RuntimeHandshakeResponse> {
    return this.#request("/v1/handshake", runtimeHandshakeResponseSchema, { method: "POST" });
  }

  async #request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#bearerToken}`,
        "x-noneedwork-protocol": String(PROTOCOL_VERSION),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new RuntimeClientError(
        `Runtime request failed with HTTP ${response.status}`,
        response.status,
        body,
      );
    }
    return schema.parse(body);
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}
