import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver,
} from "wiki-graph-core";

export class HttpWikimediaResolver implements WikimediaResolver {
  public constructor(
    private readonly endpoint: string,
    private readonly token?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async resolve(
    input: readonly WikimediaResolveInput[],
  ): Promise<readonly WikimediaResolution[]> {
    const response = await this.fetcher(
      new URL("/v1/qids:resolve", this.endpoint),
      {
        body: JSON.stringify({ entities: input }),
        headers: {
          "Content-Type": "application/json",
          ...(this.token === undefined
            ? {}
            : { Authorization: `Bearer ${this.token}` }),
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`wg-wikimedia ${response.status}`);
    }
    const payload = (await response.json()) as {
      readonly results?: readonly WikimediaResolution[];
    };
    if (!Array.isArray(payload.results)) {
      throw new Error("wg-wikimedia returned invalid results");
    }
    return payload.results;
  }
}
