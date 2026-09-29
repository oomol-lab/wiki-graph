import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver,
} from "./types.js";

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

  public async resolve(
    input: readonly WikimediaResolveInput[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly WikimediaResolution[]> {
    const response = await this.#fetcher(resolveEndpoint(this.#endpoint), {
      body: JSON.stringify({ entities: input }),
      headers: {
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
    const results = readResults(await response.json());
    if (results === undefined) {
      throw new Error("wg-wikimedia returned invalid results");
    }
    return results;
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

function readResults(
  payload: unknown,
): readonly WikimediaResolution[] | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("results" in payload) ||
    !Array.isArray(payload.results)
  ) {
    return undefined;
  }

  return payload.results as readonly WikimediaResolution[];
}
