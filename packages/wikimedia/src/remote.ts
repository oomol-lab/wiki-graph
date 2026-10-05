import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolvedItem,
  WikimediaResolver,
  WikimediaStreamEvent,
} from "./types.js";

const MAX_ENTITIES_PER_REQUEST = 1_000;

export class WikimediaServiceError extends Error {
  public readonly detail: string | undefined;
  public readonly requestId: string | undefined;
  public readonly status: number;

  public constructor(
    status: number,
    detail: string | undefined,
    requestId: string | undefined,
  ) {
    super(
      `wg-wikimedia ${status}${detail === undefined ? "" : `: ${detail}`}${requestId === undefined ? "" : ` (requestId=${requestId})`}`,
    );
    this.name = "WikimediaServiceError";
    this.status = status;
    this.detail = detail;
    this.requestId = requestId;
  }
}

export class HttpWikimediaResolver implements WikimediaResolver {
  readonly #endpoint: string;
  readonly #fetcher: typeof fetch;
  readonly #token: string;

  public constructor(
    endpoint: string,
    token: string | undefined,
    fetcher: typeof fetch = fetch,
  ) {
    this.#endpoint = endpoint;
    this.#token = requireToken(token);
    this.#fetcher = fetcher;
  }

  public async *resolve(
    input: readonly WikimediaResolveInput[],
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<WikimediaResolvedItem> {
    for (
      let offset = 0;
      offset < input.length;
      offset += MAX_ENTITIES_PER_REQUEST
    ) {
      options?.signal?.throwIfAborted();
      const batch = input.slice(offset, offset + MAX_ENTITIES_PER_REQUEST);
      for await (const item of this.#resolveBatch(batch, options)) {
        yield { index: offset + item.index, resolution: item.resolution };
      }
    }
  }

  async *#resolveBatch(
    input: readonly WikimediaResolveInput[],
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<WikimediaResolvedItem> {
    const response = await this.#fetcher(resolveEndpoint(this.#endpoint), {
      body: JSON.stringify({ entities: input }),
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#token}`,
      },
      method: "POST",
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) {
      throw new WikimediaServiceError(
        response.status,
        await readErrorDetail(response),
        response.headers.get("x-wg-request-id") ??
          response.headers.get("x-fc-request-id") ??
          undefined,
      );
    }
    const requestId =
      response.headers.get("x-wg-request-id") ??
      response.headers.get("x-fc-request-id") ??
      undefined;
    const received = new Set<number>();
    for await (const event of readEvents(response)) {
      if (event.type === "heartbeat") continue;
      if (event.type === "resolution") {
        if (event.index >= input.length) {
          throw new Error(
            `wg-wikimedia returned out-of-range input index ${event.index}`,
          );
        }
        if (received.has(event.index)) {
          throw new Error(
            `wg-wikimedia returned input index ${event.index} twice`,
          );
        }
        received.add(event.index);
        yield { index: event.index, resolution: event.resolution };
        continue;
      }
      if (event.type === "error") {
        throw new WikimediaServiceError(
          event.status,
          event.detail,
          event.requestId ?? requestId,
        );
      }
      if (received.size !== input.length) {
        throw new Error(
          `wg-wikimedia completed after ${received.size} of ${input.length} results`,
        );
      }
      return;
    }
    throw new Error("wg-wikimedia stream ended before the done event");
  }
}

async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const text = (await response.text()).slice(0, 16_384);
  if (text.trim() === "") return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" &&
      value !== null &&
      "detail" in value &&
      typeof value.detail === "string"
      ? value.detail
      : text;
  } catch {
    return text;
  }
}

function requireToken(token: string | undefined): string {
  const normalized = token?.trim();
  if (normalized === undefined || normalized === "") {
    throw new Error("wg-wikimedia requires a Bearer API key");
  }
  return normalized;
}

function resolveEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const prefix = url.pathname.replace(/\/+$/u, "");
  url.pathname = prefix === "" ? "/v1/qids:resolve" : `${prefix}/qids:resolve`;
  return url;
}

async function* readEvents(
  response: Response,
): AsyncIterable<WikimediaStreamEvent> {
  if (response.body === null) {
    for (const line of (await response.text()).split(/\r?\n/u)) {
      if (line.trim() !== "") yield parseEvent(line);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") yield parseEvent(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") yield parseEvent(buffer);
  } finally {
    if (!completed) await reader.cancel();
    reader.releaseLock();
  }
}

function parseEvent(line: string): WikimediaStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `wg-wikimedia returned invalid NDJSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("wg-wikimedia returned an invalid stream event");
  }
  const event = value as Record<string, unknown>;
  if (event.type === "done" || event.type === "heartbeat") {
    return { type: event.type };
  }
  if (
    event.type === "resolution" &&
    Number.isInteger(event.index) &&
    Number(event.index) >= 0 &&
    isResolution(event.resolution)
  ) {
    return {
      index: Number(event.index),
      resolution: event.resolution,
      type: "resolution",
    };
  }
  if (
    event.type === "error" &&
    typeof event.status === "number" &&
    (event.detail === undefined || typeof event.detail === "string") &&
    (event.requestId === undefined || typeof event.requestId === "string")
  ) {
    return {
      ...(event.detail === undefined ? {} : { detail: event.detail }),
      ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
      status: event.status,
      type: "error",
    };
  }
  throw new Error("wg-wikimedia returned an invalid stream event");
}

function isResolution(value: unknown): value is WikimediaResolution {
  if (typeof value !== "object" || value === null) return false;
  const resolution = value as Record<string, unknown>;
  return (
    typeof resolution.qid === "string" &&
    isLanguageProfile(resolution.en) &&
    isLanguageProfile(resolution.zh)
  );
}

function isLanguageProfile(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return [profile.description, profile.label, profile.url].every(
    (item) => item === null || typeof item === "string",
  );
}
