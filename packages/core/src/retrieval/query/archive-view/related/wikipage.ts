import type { WikimediaLanguageProfile } from "../../../../external/wikipage/index.js";

import type { ArchiveEntityWikipageLocale } from "../types.js";
import type { ArchivePageOptions } from "../pages.js";

export async function resolveEntityWikipage(
  qid: string,
  options: ArchivePageOptions,
): Promise<{
  readonly en: ArchiveEntityWikipageLocale | null;
  readonly zh: ArchiveEntityWikipageLocale | null;
}> {
  if (options.wikimediaResolver === undefined) {
    throw new Error(
      "Reading an entity wikipage requires a Wikimedia provider.",
    );
  }

  let resolution;
  const stream = options.wikimediaResolver.resolve(
    [{ disambiguation: false, qid }],
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  for await (const item of stream) {
    if (item.index !== 0) {
      throw new Error(
        `Wikimedia resolver returned invalid input index ${item.index}`,
      );
    }
    if (resolution !== undefined) {
      throw new Error("Wikimedia resolver returned input index 0 twice");
    }
    resolution = item.resolution;
  }
  if (resolution === undefined) {
    throw new Error("Wikimedia resolver ended after 0 of 1 results");
  }

  return {
    en: createEntityWikipageLocale(resolution?.en),
    zh: createEntityWikipageLocale(resolution?.zh),
  };
}

function createEntityWikipageLocale(
  profile: WikimediaLanguageProfile | undefined,
): ArchiveEntityWikipageLocale | null {
  if (
    profile?.label === null ||
    profile?.url === null ||
    profile === undefined
  ) {
    return null;
  }

  return {
    ...(profile.description === null
      ? {}
      : { description: profile.description }),
    label: profile.label,
    url: profile.url,
  };
}
