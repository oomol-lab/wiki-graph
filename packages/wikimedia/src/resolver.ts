import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver as WikimediaResolverContract,
} from "wiki-graph-core";

import type { Store } from "./store.js";
import type { ProfileNormalizer, WikimediaClient } from "./types.js";

export class WikimediaResolver implements WikimediaResolverContract {
  readonly #client: WikimediaClient;
  readonly #normalizer: ProfileNormalizer;
  readonly #store: Store;

  public constructor(
    store: Store,
    client: WikimediaClient,
    normalizer: ProfileNormalizer,
  ) {
    this.#store = store;
    this.#client = client;
    this.#normalizer = normalizer;
  }

  public async resolve(
    input: readonly WikimediaResolveInput[],
  ): Promise<readonly WikimediaResolution[]> {
    return await this.#store.resolve(input, this.#client, this.#normalizer);
  }
}
