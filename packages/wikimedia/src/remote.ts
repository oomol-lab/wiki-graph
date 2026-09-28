import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver,
} from "wiki-graph-core";

export class HttpWikimediaResolver implements WikimediaResolver {
  readonly #endpoint: string;
  readonly #fetcher: typeof fetch;
  readonly #token: string | undefined;

  public constructor(
    endpoint: string,
    token?: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.#endpoint = endpoint;
    this.#token = token;
    this.#fetcher = fetcher;
  }

  public async resolve(
    input: readonly WikimediaResolveInput[],
  ): Promise<readonly WikimediaResolution[]> {
    const response = await this.#fetcher(
      new URL("/v1/qids:resolve", this.#endpoint),
      {
        body: JSON.stringify({ entities: input }),
        headers: {
          "Content-Type": "application/json",
          ...(this.#token === undefined
            ? {}
            : { Authorization: `Bearer ${this.#token}` }),
        },
        method: "POST",
      },
    );
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
