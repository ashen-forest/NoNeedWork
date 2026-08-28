import {
  type ArtifactList,
  artifactListSchema,
  type CreateTaskRequest,
  type EventPage,
  type EventStreamFrame,
  eventPageSchema,
  eventStreamFrameSchema,
  type OpenProjectRequest,
  PROTOCOL_VERSION,
  type Project,
  type ProjectList,
  projectListSchema,
  projectSchema,
  type RuntimeHandshakeResponse,
  type RuntimeHealth,
  runtimeHandshakeResponseSchema,
  runtimeHealthSchema,
  type TaskControlAction,
  type TaskDetails,
  taskDetailsSchema,
} from "@noneedwork/protocol";

export interface RuntimeClientOptions {
  baseUrl: string;
  bearerToken: string;
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: RuntimeWebSocketFactory;
}

export interface RuntimeWebSocket {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  close(): void;
}

export type RuntimeWebSocketFactory = (
  url: string,
  protocols: readonly string[],
) => RuntimeWebSocket;

export interface EventStreamSubscription {
  close(): void;
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
  readonly #webSocketFactory: RuntimeWebSocketFactory;

  constructor(options: RuntimeClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!isLoopback(this.#baseUrl.hostname)) {
      throw new Error("NoNeedWork RuntimeClient only accepts loopback endpoints");
    }
    this.#bearerToken = options.bearerToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  health(): Promise<RuntimeHealth> {
    return this.#request("/v1/health", runtimeHealthSchema);
  }

  handshake(): Promise<RuntimeHandshakeResponse> {
    return this.#request("/v1/handshake", runtimeHandshakeResponseSchema, { method: "POST" });
  }

  openProject(input: OpenProjectRequest): Promise<Project> {
    return this.#request("/v1/projects/open", projectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listProjects(): Promise<ProjectList> {
    return this.#request("/v1/projects", projectListSchema);
  }

  createTask(input: CreateTaskRequest): Promise<TaskDetails> {
    return this.#request("/v1/tasks", taskDetailsSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getTask(taskId: string): Promise<TaskDetails> {
    return this.#request(`/v1/tasks/${encodeURIComponent(taskId)}`, taskDetailsSchema);
  }

  controlTask(taskId: string, action: TaskControlAction): Promise<TaskDetails> {
    return this.#request(`/v1/tasks/${encodeURIComponent(taskId)}/control`, taskDetailsSchema, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  }

  listEvents(taskId: string, after = 0, limit = 200): Promise<EventPage> {
    const query = new URLSearchParams({ after: String(after), limit: String(limit) });
    return this.#request(
      `/v1/tasks/${encodeURIComponent(taskId)}/events?${query.toString()}`,
      eventPageSchema,
    );
  }

  streamEvents(
    taskId: string,
    handlers: {
      onFrame(frame: EventStreamFrame): void;
      onError?(error: unknown): void;
      onClose?(): void;
    },
    after = 0,
  ): EventStreamSubscription {
    const url = new URL(
      `/v1/tasks/${encodeURIComponent(taskId)}/events/stream?after=${String(after)}`,
      this.#baseUrl,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.#webSocketFactory(url.toString(), [
      `noneedwork.v${PROTOCOL_VERSION}`,
      `noneedwork.token.${this.#bearerToken}`,
    ]);
    socket.addEventListener("message", (event) => {
      try {
        if (typeof event.data !== "string") {
          throw new Error("Runtime event stream returned a non-text frame");
        }
        handlers.onFrame(eventStreamFrameSchema.parse(JSON.parse(event.data)));
      } catch (error) {
        handlers.onError?.(error);
      }
    });
    socket.addEventListener("error", (error) => handlers.onError?.(error));
    socket.addEventListener("close", () => handlers.onClose?.());
    return { close: () => socket.close() };
  }

  listArtifacts(taskId: string): Promise<ArtifactList> {
    return this.#request(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts`, artifactListSchema);
  }

  async downloadArtifact(artifactId: string): Promise<Uint8Array> {
    const response = await this.#fetchResponse(`/v1/artifacts/${encodeURIComponent(artifactId)}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async #request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.#fetchResponse(path, init);
    const body = await response.json().catch(() => undefined);
    return schema.parse(body);
  }

  async #fetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#bearerToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        "x-noneedwork-protocol": String(PROTOCOL_VERSION),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new RuntimeClientError(
        `Runtime request failed with HTTP ${response.status}`,
        response.status,
        body,
      );
    }
    return response;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function defaultWebSocketFactory(url: string, protocols: readonly string[]): RuntimeWebSocket {
  return new WebSocket(url, [...protocols]);
}
