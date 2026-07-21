import type { ReadonlyDocument } from "../../../../document/index.js";
import { createLexicalQuery, listLexicalQueryCandidateTerms, type LexicalQuery } from "../../lexical-search.js";
import {
  createEntitySearchSession,
  createSearchSession,
  decodeSearchSessionCursor,
  readCachedEntitySearchSessionPage,
  readCachedSearchSessionPage,
  readEntitySearchSessionPage,
  readSearchSessionDescriptor,
  readSearchSessionPage,
} from "../../search-cache/index.js";

import {
  BROAD_FIND_LENS_HINT,
  DEFAULT_FIND_LIMIT,
  compareNumbers,
  createFindResult,
  createPhraseSearch,
  createRankedFindResult,
  isFindCursor,
  parseFindLens,
  parseFindMatch,
  parseFindTypes,
} from "../helpers.js";
import { isArchiveSearchIndexCurrent } from "../index-state.js";
import {
  assertSearchCursorTypesMatch,
  createEntitySearchCacheInput,
  createSentenceEvidenceSearchCacheInput,
  isEntityOnlySearch,
  isEntitySearchTypes,
} from "./cache-input.js";
import {
  filterLexicalHitsByMatch,
  findChapters,
  findEntities,
  findMeta,
  findNodes,
  findTriples,
} from "../find.js";
import {
  createFindEvidenceHydrationOptions,
  hydrateFindHitEvidence,
} from "../evidence.js";
import {
  hydrateFindResultBacklinks,
} from "../backlinks.js";
import {
  readBucketedSearchResultPage,
  tryDecodeBucketSearchSessionCursor,
} from "./buckets.js";
import { findArchiveObjectsIndexed, isTextOnlySearch } from "./hydration.js";
import type { ArchiveFindHit, ArchiveFindOptions, ArchiveFindResult } from "../types.js";

export async function findArchiveObjects(
  document: ReadonlyDocument,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const textOnlySearch = isTextOnlySearch(options);

  if (
    options.cursor !== undefined &&
    (!textOnlySearch || !isFindCursor(options.cursor))
  ) {
    const bucketCursor = tryDecodeBucketSearchSessionCursor(options.cursor);

    if (bucketCursor !== undefined) {
      return await readBucketedSearchResultPage(document, bucketCursor, {
        ...options,
        limit,
      });
    }

    const cursor = decodeSearchSessionCursor(options.cursor);
    const descriptor = await readSearchSessionDescriptor(
      cursor.sessionId,
      options.archiveKey ?? "archive",
    );

    assertSearchCursorTypesMatch(options.types, descriptor.types);

    const page = isEntitySearchTypes(descriptor.types)
      ? await readEntitySearchSessionPage(
          cursor.sessionId,
          cursor.offset,
          limit,
          options.archiveKey ?? "archive",
          cursor.createdAt,
        )
      : await readSearchSessionPage(
          cursor.sessionId,
          cursor.offset,
          limit,
          options.archiveKey ?? "archive",
          cursor.createdAt,
        );

    return await hydrateFindResultBacklinks(
      document,
      {
        chapters: page.chapters,
        items: await hydrateFindHitEvidence(
          document,
          page.items,
          createFindEvidenceHydrationOptions(options, cursor.sessionId),
        ),
        lens: parseFindLens(page.lens),
        lensHint: page.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
        limit,
        match: parseFindMatch(page.match),
        nextCursor: page.nextCursor,
        order: options.order ?? "doc-asc",
        query: page.query,
        terms: page.terms,
        types: parseFindTypes(descriptor.types),
      },
      options,
    );
  }

  const requestedTypes = options.types ?? null;
  const wantsStructuredSearch =
    requestedTypes === null ||
    requestedTypes.includes("entity") ||
    requestedTypes.includes("triple");
  const search = createLexicalQuery(query);

  if (search === undefined) {
    return createFindResult(query, [], options);
  }

  if (textOnlySearch) {
    return await findTextOnlyArchiveObjectsIndexed(
      document,
      query,
      options,
      search,
    );
  }

  const revisionScope = await createSearchRevisionScope(
    document,
    options.chapters,
  );
  const cacheInput = {
    archiveKey: options.archiveKey ?? "archive",
    chapters: options.chapters ?? null,
    lens: options.types === undefined ? "broad" : "typed",
    match: options.match ?? "any",
    order: options.order ?? "doc-asc",
    query,
    revisionScope,
    terms: search.terms,
    types: options.types ?? null,
  };
  const canReadSearchCache = options.triplePattern === undefined;
  const usesBucketedSearch =
    options.types === undefined && options.triplePattern === undefined;

  if (canReadSearchCache && isEntityOnlySearch(options)) {
    const cachedPage = await readCachedEntitySearchSessionPage(
      cacheInput,
      0,
      limit,
    );

    if (cachedPage !== undefined) {
      return await hydrateFindResultBacklinks(
        document,
        {
          chapters: cachedPage.chapters,
          items: await hydrateFindHitEvidence(
            document,
            cachedPage.items,
            createFindEvidenceHydrationOptions(options, cachedPage.sessionId),
          ),
          lens: parseFindLens(cachedPage.lens),
          lensHint: cachedPage.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
          limit,
          match: parseFindMatch(cachedPage.match),
          nextCursor: cachedPage.nextCursor,
          order: options.order ?? "doc-asc",
          query: cachedPage.query,
          terms: cachedPage.terms,
          types: parseFindTypes(cachedPage.types),
        },
        options,
      );
    }
  } else if (canReadSearchCache && !usesBucketedSearch) {
    const cachedPage = await readCachedSearchSessionPage(cacheInput, 0, limit);

    if (cachedPage !== undefined) {
      return await hydrateFindResultBacklinks(
        document,
        {
          chapters: cachedPage.chapters,
          items: await hydrateFindHitEvidence(
            document,
            cachedPage.items,
            createFindEvidenceHydrationOptions(options),
          ),
          lens: parseFindLens(cachedPage.lens),
          lensHint: cachedPage.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
          limit,
          match: parseFindMatch(cachedPage.match),
          nextCursor: cachedPage.nextCursor,
          order: options.order ?? "doc-asc",
          query: cachedPage.query,
          terms: cachedPage.terms,
          types: parseFindTypes(cachedPage.types),
        },
        options,
      );
    }
  }

  if (usesBucketedSearch) {
    if (!(await isArchiveSearchIndexCurrent(document))) {
      throw new Error(
        "Wiki Graph search index is missing or outdated. Run `<archive-uri>/index enable` before searching.",
      );
    }
    const sessionId = await createSearchSession({
      archiveKey: options.archiveKey ?? "archive",
      chapters: options.chapters ?? null,
      lens: "broad",
      match: options.match ?? "any",
      order: options.order ?? "doc-asc",
      query,
      revisionScope,
      terms: search.terms,
      types: null,
    });
    const descriptor = await readSearchSessionDescriptor(
      sessionId,
      options.archiveKey ?? "archive",
    );

    return await readBucketedSearchResultPage(
      document,
      {
        createdAt: descriptor.createdAt,
        cursor: { bucket: 0 },
        sessionId,
      },
      { ...options, limit },
    );
  }

  const allMentions = wantsStructuredSearch
    ? await document.mentions.listBySurfaceTerms(
        listLexicalQueryCandidateTerms(query),
      )
    : [];
  const indexed = await findArchiveObjectsIndexed(document, query, options);
  const structuredHits = wantsStructuredSearch
    ? [
        ...findEntities(search, { mentions: allMentions }),
        ...(await findTriples(document, search, { mentions: allMentions })),
      ]
    : [];
  const hits = [...structuredHits, ...(indexed?.hits ?? [])];
  if (isEntityOnlySearch(options)) {
    const ranked = createRankedFindResult(
      query,
      filterLexicalHitsByMatch(hits, search, options.match ?? "any"),
      options,
      search.terms,
    );
    const entityCacheInput = createEntitySearchCacheInput(
      ranked.items,
      indexed?.result,
    );
    const sentenceCacheInput = await createSentenceEvidenceSearchCacheInput(
      document,
      indexed?.result,
      options,
    );
    const sessionId = await createEntitySearchSession({
      archiveKey: options.archiveKey ?? "archive",
      chapters: ranked.chapters,
      chunkHits: sentenceCacheInput.chunkHits,
      entityHits: [
        ...entityCacheInput.entityHits,
        ...sentenceCacheInput.entityHits,
      ],
      evidenceEvents: [
        ...entityCacheInput.evidenceEvents,
        ...sentenceCacheInput.evidenceEvents,
      ],
      lens: ranked.lens,
      match: ranked.match,
      order: ranked.order,
      query,
      revisionScope,
      terms: ranked.terms,
      tripleHits: sentenceCacheInput.tripleHits,
      types: ranked.types,
    });
    const firstPage = await readEntitySearchSessionPage(sessionId, 0, limit);

    return await hydrateFindResultBacklinks(
      document,
      {
        ...ranked,
        items: await hydrateFindHitEvidence(
          document,
          firstPage.items,
          createFindEvidenceHydrationOptions(options, sessionId),
        ),
        nextCursor: firstPage.nextCursor,
      },
      options,
    );
  }

  const ranked = createRankedFindResult(
    query,
    filterLexicalHitsByMatch(hits, search, options.match ?? "any"),
    options,
    search.terms,
  );
  const entityCacheInput = createEntitySearchCacheInput(
    ranked.items,
    indexed?.result,
  );
  const sentenceCacheInput = await createSentenceEvidenceSearchCacheInput(
    document,
    indexed?.result,
    options,
  );
  const sessionId = await createSearchSession({
    archiveKey: options.archiveKey ?? "archive",
    chapters: ranked.chapters,
    chunkHits: sentenceCacheInput.chunkHits,
    entityHits: [
      ...entityCacheInput.entityHits,
      ...sentenceCacheInput.entityHits,
    ],
    evidenceEvents: [
      ...entityCacheInput.evidenceEvents,
      ...sentenceCacheInput.evidenceEvents,
    ],
    items: ranked.items,
    lens: ranked.lens,
    match: ranked.match,
    order: ranked.order,
    query,
    revisionScope,
    terms: ranked.terms,
    tripleHits: sentenceCacheInput.tripleHits,
    types: ranked.types,
  });
  const firstPage = await readSearchSessionPage(sessionId, 0, limit);

  return await hydrateFindResultBacklinks(
    document,
    {
      ...ranked,
      items: await hydrateFindHitEvidence(
        document,
        firstPage.items,
        createFindEvidenceHydrationOptions(options),
      ),
      nextCursor: firstPage.nextCursor,
    },
    options,
  );
}

async function findTextOnlyArchiveObjectsIndexed(
  document: ReadonlyDocument,
  query: string,
  options: ArchiveFindOptions,
  search: LexicalQuery,
): Promise<ArchiveFindResult> {
  const indexed = await findArchiveObjectsIndexed(document, query, options);
  const hits = indexed?.hits ?? [];

  return createFindResult(
    query,
    filterLexicalHitsByMatch(hits, search, options.match ?? "any"),
    options,
    indexed?.result.terms ?? search.terms,
  );
}

async function createSearchRevisionScope(
  document: ReadonlyDocument,
  chapters: readonly number[] | undefined,
): Promise<string> {
  if (chapters === undefined || chapters.length === 0) {
    return JSON.stringify({
      chaptersRevision: await document.serials.getChaptersRevision(),
      scope: "all",
    });
  }

  const uniqueChapters = [...new Set(chapters)].sort(compareNumbers);
  const revisions = await document.serials.getRevisions(uniqueChapters);

  return JSON.stringify({
    chapters: uniqueChapters.map(
      (chapterId) => [chapterId, revisions.get(chapterId) ?? 0] as const,
    ),
    scope: "chapters",
  });
}

export async function grepArchiveObjects(
  document: ReadonlyDocument,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  const search = createPhraseSearch(query);

  if (search === undefined) {
    return createFindResult(
      query,
      [],
      { ...options, match: "all" },
      [],
      "exact",
    );
  }

  const hits: ArchiveFindHit[] = [];

  hits.push(...findMeta(await document.readBookMeta(), search));
  hits.push(...(await findChapters(document, search)));
  hits.push(...(await findNodes(document, search)));

  return createFindResult(
    query,
    hits,
    { ...options, match: "all" },
    [query.trim().toLowerCase()],
    "exact",
  );
}
