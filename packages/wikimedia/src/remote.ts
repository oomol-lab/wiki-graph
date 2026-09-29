import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver,
} from "./types.js";

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
      throw new Error(`wg-wikimedia ${response.status}`);
    }
    const results = readResults(await response.json());
    if (results === undefined) {
      throw new Error("wg-wikimedia returned invalid results");
    }
    return results;
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
