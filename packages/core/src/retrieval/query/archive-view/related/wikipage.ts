import { WikipageResolver } from "../../../../external/wikipage/index.js";
import type {
  QidResolution,
  WikipageSitelink,
} from "../../../../external/wikipage/index.js";

import type { ArchiveEntityWikipageLocale } from "../types.js";
import type { ArchivePageOptions } from "../pages.js";

export async function resolveEntityWikipage(
  qid: string,
  options: ArchivePageOptions,
): Promise<{
  readonly en: ArchiveEntityWikipageLocale | null;
  readonly zh: ArchiveEntityWikipageLocale | null;
}> {
  const [en, zh] = await Promise.all([
    resolveEntityWikipageLocale(qid, "en", "enwiki", options),
    resolveEntityWikipageLocale(qid, "zh", "zhwiki", options),
  ]);

  return { en, zh };
}

async function resolveEntityWikipageLocale(
  qid: string,
  language: "en" | "zh",
  wiki: "enwiki" | "zhwiki",
  options: ArchivePageOptions,
): Promise<ArchiveEntityWikipageLocale | null> {
  const resolver = await WikipageResolver.open({
    ...options.wikipageResolverOptions,
    language,
    wiki,
  });

  try {
    const [resolution] = await resolver.resolveQids([qid]);

    if (resolution === undefined) {
      return null;
    }

    return createEntityWikipageLocale(resolution, wiki);
  } finally {
    await resolver.close();
  }
}

function createEntityWikipageLocale(
  resolution: QidResolution,
  wiki: "enwiki" | "zhwiki",
): ArchiveEntityWikipageLocale | null {
  const sitelink =
    resolution.sitelinks?.find((item) => item.wiki === wiki) ??
    (resolution.sitelink?.wiki === wiki ? resolution.sitelink : undefined);

  if (sitelink === undefined) {
    return null;
  }

  return {
    ...(resolution.description === undefined
      ? {}
      : { description: resolution.description }),
    title: sitelink.title,
    url: formatWikipediaPageUrl(sitelink),
  };
}

function formatWikipediaPageUrl(sitelink: WikipageSitelink): string {
  const language = sitelink.wiki === "zhwiki" ? "zh" : "en";

  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(sitelink.title.replaceAll(" ", "_"))}`;
}
