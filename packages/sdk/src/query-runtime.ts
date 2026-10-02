import {
  openWikimediaResolver,
  type SearchIndexEmbeddingProvider,
} from "wiki-graph-core";

import {
  buildSearchIndexEmbeddingProvider,
  readWikiGraphEmbeddingConfig,
} from "./embedding.js";
import { loadWikiGraphRuntimeConfig } from "./runtime-config.js";

export async function createConfiguredEmbeddingProvider(): Promise<
  SearchIndexEmbeddingProvider | undefined
> {
  const config = await readWikiGraphEmbeddingConfig();
  if (
    config.provider === undefined ||
    config.model === undefined ||
    (config.provider === "openai-compatible" && config.baseURL === undefined) ||
    (config.provider === "openai" && config.baseURL !== undefined)
  ) {
    return undefined;
  }
  return buildSearchIndexEmbeddingProvider(config);
}

export async function withConfiguredWikimediaResolver<T>(
  objectUri: string,
  operation: (
    options:
      | Record<string, never>
      | {
          readonly wikimediaResolver: Awaited<
            ReturnType<typeof openWikimediaResolver>
          >;
        },
  ) => Promise<T>,
): Promise<T> {
  if (!objectUri.endsWith("/wikipage")) return await operation({});

  const config = await loadWikiGraphRuntimeConfig();
  const resolver = await openWikimediaResolver(
    config.wikimedia === undefined
      ? { kind: "local" }
      : {
          endpoint: config.wikimedia.endpoint,
          kind: "remote",
          token: config.wikimedia.token,
        },
  );
  try {
    return await operation({ wikimediaResolver: resolver });
  } finally {
    await resolver.close();
  }
}
