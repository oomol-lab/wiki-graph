import type {
  WikimediaResolution,
  WikimediaResolveInput,
  WikimediaResolver as WikimediaResolverContract,
} from "wiki-graph-core";

import { Store } from "./store.js";
import type { ProfileNormalizer, WikimediaClient } from "./types.js";

export class WikimediaResolver implements WikimediaResolverContract {
  public constructor(
    private readonly store: Store,
    private readonly client: WikimediaClient,
    private readonly normalizer: ProfileNormalizer,
  ) {}

  public async resolve(
    input: readonly WikimediaResolveInput[],
  ): Promise<readonly WikimediaResolution[]> {
    return await this.store.resolve(input, this.client, this.normalizer);
  }
}
