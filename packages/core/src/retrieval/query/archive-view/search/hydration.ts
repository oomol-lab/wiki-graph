import type { ReadonlyDocument } from "../../../../document/index.js";
import {
  listChapters,
  type ChapterEntry,
} from "../../../../document/chapter/index.js";
import {
  querySearchIndex,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexObjectHit,
  type SearchIndexQueryResult,
  type SearchIndexTextHit,
} from "../../../search-index/search/index.js";

import { createSnippet, createNodePosition } from "../helpers.js";
import { formatNodeId, formatTextStreamRangeUri } from "../references.js";
import { readTextStreamRange } from "../text-streams.js";
import { TEXT_ONLY_SEARCH_CACHE_WINDOW } from "../helpers.js";
import { isArchiveSearchIndexCurrent } from "../index-state.js";
import type { ArchiveFindHit, ArchiveFindOptions } from "../types.js";

export async function findArchiveObjectsIndexed(
  document: ReadonlyDocument,
  query: string,
  options: ArchiveFindOptions,
): Promise<
  | {
      readonly hits: readonly ArchiveFindHit[];
      readonly result: SearchIndexQueryResult;
    }
  | undefined
> {
  if (!(await isArchiveSearchIndexCurrent(document))) {
    throw new Error(
      "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
    );
  }
  const result = await querySearchIndex(document, query, {
    ...(options.chapters === undefined ? {} : { chapters: options.chapters }),
    ...(options.match === undefined ? {} : { match: options.match }),
    ...createSearchIndexQueryLimitOptions(options),
    types: options.types ?? null,
  });

  return result === undefined
    ? undefined
    : {
        hits: await hydrateSearchIndexHits(
          document,
          result,
          createSearchIndexHydrationOptions(options),
        ),
        result,
      };
}

export async function queryRequiredSearchIndex(
  document: ReadonlyDocument,
  query: string,
  options: Parameters<typeof querySearchIndex>[2],
): Promise<SearchIndexQueryResult | undefined> {
  if (!(await isArchiveSearchIndexCurrent(document))) {
    throw new Error(
      "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
    );
  }

  return await querySearchIndex(document, query, options);
}

export async function hydrateSearchIndexHits(
  document: ReadonlyDocument,
  result: SearchIndexQueryResult,
  options: {
    readonly textHitLimit?: number;
  } = {},
): Promise<readonly ArchiveFindHit[]> {
  const chapters = new Map(
    (await listChapters(document)).map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
  );
  const hits: ArchiveFindHit[] = [];

  for (const hit of result.objectHits) {
    const hydrated = await hydrateSearchObjectHit(document, chapters, hit);

    if (hydrated !== undefined) {
      hits.push(withSearchTerms(hydrated, result.terms));
    }
  }

  const textHits =
    options.textHitLimit === undefined
      ? result.textHits
      : result.textHits.slice(0, options.textHitLimit);

  for (const hit of textHits) {
    const hydrated = await hydrateSearchTextHit(document, chapters, hit);

    if (hydrated !== undefined) {
      hits.push(withSearchTerms(hydrated, result.terms));
    }
  }

  return hits;
}

export function createSearchIndexHydrationOptions(
  options: ArchiveFindOptions,
): {
  readonly textHitLimit?: number;
} {
  if (!isTextOnlySearch(options) || options.limit === undefined) {
    return {};
  }

  return { textHitLimit: createTextOnlySearchCacheWindow(options.limit) };
}

export function createSearchIndexQueryLimitOptions(
  options: ArchiveFindOptions,
): {
  readonly textHitLimit?: number;
} {
  if (!isTextOnlySearch(options) || options.limit === undefined) {
    return {};
  }

  return { textHitLimit: createTextOnlySearchCacheWindow(options.limit) };
}

export function createTextOnlySearchCacheWindow(limit: number): number {
  return Math.max(limit + 1, TEXT_ONLY_SEARCH_CACHE_WINDOW);
}

export function isTextOnlySearch(options: ArchiveFindOptions): boolean {
  return (
    options.types !== undefined &&
    options.types.length > 0 &&
    options.types.every((type) => type === "source" || type === "summary")
  );
}

export function withSearchTerms(
  hit: ArchiveFindHit,
  terms: readonly string[],
): ArchiveFindHit {
  return {
    ...hit,
    matchCount: terms.length,
    matchedTerms: terms,
    missingTerms: [],
  };
}

export async function hydrateSearchObjectHit(
  document: ReadonlyDocument,
  chapters: ReadonlyMap<number, ChapterEntry>,
  hit: SearchIndexObjectHit,
): Promise<ArchiveFindHit | undefined> {
  switch (hit.ownerKind) {
    case SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter: {
      const chapterId = parseSearchPropertyIntegerOwnerId(hit.ownerId);
      const chapter = chapters.get(chapterId);

      if (chapter === undefined) {
        return undefined;
      }

      const title = chapter.title ?? chapter.uri;

      return {
        chapter: chapter.chapterId,
        field: "title",
        id: `${chapter.uri}/title`,
        matchCount: 1,
        position: { chapter: chapter.chapterId },
        score: hit.score,
        snippet: title,
        title,
        type: "chapter-title",
      };
    }
    case SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk: {
      const chunkId = parseSearchPropertyIntegerOwnerId(hit.ownerId);
      const node = await document.chunks.getById(chunkId);

      if (node === undefined) {
        return undefined;
      }

      const position = createNodePosition(node.sentenceIds);
      const isLabel = hit.propertyKind === SEARCH_OBJECT_PROPERTY_KIND.label;

      return {
        chapter: node.sentenceId[0],
        field: isLabel ? "title" : "content",
        id: formatNodeId(node.id),
        matchCount: 1,
        ...(position === undefined ? {} : { position }),
        score: hit.score,
        snippet: isLabel ? node.label : createSnippet(node.content),
        title: node.label,
        type: "node",
      };
    }
    case SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity:
      return undefined;
  }
}

export function parseSearchPropertyIntegerOwnerId(ownerId: string): number {
  const value = Number(ownerId);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid search property owner id: ${ownerId}`);
  }

  return value;
}

export async function hydrateSearchTextHit(
  document: ReadonlyDocument,
  chapters: ReadonlyMap<number, ChapterEntry>,
  hit: SearchIndexTextHit,
): Promise<ArchiveFindHit | undefined> {
  const stream =
    hit.kind === TEXT_SENTENCE_KIND.source
      ? ("source" as const)
      : ("summary" as const);
  const chapter = chapters.get(hit.chapterId);

  if (chapter === undefined) {
    return undefined;
  }

  const range = await readTextStreamRange(
    document,
    hit.chapterId,
    stream,
    hit.sentenceIndex,
    hit.sentenceIndex,
  );

  return {
    chapter: hit.chapterId,
    field: stream,
    id: formatTextStreamRangeUri(
      chapter.path,
      stream,
      range.startSentenceIndex,
      range.endSentenceIndex,
    ),
    matchCount: 1,
    position: {
      chapter: hit.chapterId,
      sentence: hit.sentenceIndex,
    },
    score: hit.score,
    snippet: createSnippet(range.text),
    title: chapter.title ?? chapter.uri,
    type: stream,
  };
}
