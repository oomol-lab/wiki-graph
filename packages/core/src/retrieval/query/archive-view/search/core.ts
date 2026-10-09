import type { ReadonlyDocument } from "../../../../document/index.js";
import {
  createLexicalQuery,
  listLexicalQueryCandidateTerms,
  type LexicalQuery,
} from "../../lexical-search.js";
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
  decodeFindCursor,
  isFindCursor,
  parseFindLens,
  parseFindMatch,
  parseFindTypes,
  readArchiveMetaForQuery,
  decodeTextSearchCursor,
  encodeTextSearchCursor,
  isTextSearchCursor,
} from "../helpers.js";
import { isArchiveSearchIndexCurrent } from "../index-state.js";
import {
  assertSearchCursorContextMatch,
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
import { hydrateFindResultBacklinks } from "../backlinks.js";
import {
  readBucketedSearchResultPage,
  tryDecodeBucketSearchSessionCursor,
} from "./buckets.js";
import { findArchiveObjectsIndexed, isTextOnlySearch } from "./hydration.js";
import type {
  ArchiveFindHit,
  ArchiveFindOptions,
  ArchiveFindResult,
} from "../types.js";
import { SEARCH_INDEX_VERSION } from "../../../search-index/index.js";

export async function findArchiveObjects(
  document: ReadonlyDocument,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const textCursor = decodeTextSearchCursor(options.cursor);
  const textOnlySearch = textCursor !== undefined || isTextOnlySearch(options);
  if (
    options.cursor !== undefined &&
    (!textOnlySearch ||
      (!isFindCursor(options.cursor) && !isTextSearchCursor(options.cursor)))
  ) {
    const bucketCursor = tryDecodeBucketSearchSessionCursor(options.cursor);

    if (bucketCursor !== undefined) {
      return await readBucketedSearchResultPage(document, query, bucketCursor, {
        ...options,
        limit,
      });
    }

    const cursor = decodeSearchSessionCursor(options.cursor);
    const descriptor = await readSearchSessionDescriptor(
      cursor.sessionId,
      options.archiveKey ?? "archive",
    );

    assertSearchCursorContextMatch(query, options, descriptor);
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
        order: descriptor.order,
        query: page.query,
        terms: page.terms,
        types: parseFindTypes(descriptor.types),
      },
      options,
    );
  }

  const requestedTypes = options.types ?? null;
  const wantsStructuredSearch =
    options.queryMode !== "embedding" &&
    (requestedTypes === null ||
      requestedTypes.includes("entity") ||
      requestedTypes.includes("triple"));
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
    queryMode: options.queryMode ?? "hybrid",
    revisionScope,
    terms: search.terms,
    types: options.types ?? null,
  };
  const canReadSearchCache = options.triplePattern === undefined;
  const usesEmbedding =
    options.queryMode === "embedding" ||
    (options.queryMode !== "fts" && options.embeddingProvider !== undefined);
  const usesBucketedSearch =
    options.triplePattern === undefined &&
    (options.types === undefined ||
      (usesEmbedding &&
        options.types.some(
          (type) =>
            type === "chapter" ||
            type === "chapter-title" ||
            type === "node" ||
            type === "triple",
        )));

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
    if (
      !(await isArchiveSearchIndexCurrent(document, {
        ...(options.chapters === undefined
          ? {}
          : { chapters: options.chapters }),
      }))
    ) {
      throw new Error(
        "Wiki Graph index cache is missing or outdated. Run `<archive-uri>/index sync` before searching.",
      );
    }
    const sessionId = await createSearchSession({
      archiveKey: options.archiveKey ?? "archive",
      chapters: options.chapters ?? null,
      lens: options.types === undefined ? "broad" : "typed",
      match: options.match ?? "any",
      order: options.order ?? "doc-asc",
      query,
      queryMode: options.queryMode ?? "hybrid",
      revisionScope,
      terms: search.terms,
      types: options.types ?? null,
    });
    const descriptor = await readSearchSessionDescriptor(
      sessionId,
      options.archiveKey ?? "archive",
    );

    return await readBucketedSearchResultPage(
      document,
      query,
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
      queryMode: options.queryMode ?? "hybrid",
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
    queryMode: options.queryMode ?? "hybrid",
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
  const cursor = decodeTextSearchCursor(options.cursor);
  if (cursor !== undefined) {
    if (cursor.query !== query) {
      throw new Error("Search cursor does not match the requested query.");
    }
    if (
      options.queryMode !== undefined &&
      options.queryMode !== cursor.queryMode
    ) {
      throw new Error("Search cursor does not match the requested query mode.");
    }
    if (
      (options.archiveKey ?? "archive") !== (cursor.archiveKey ?? "archive")
    ) {
      throw new Error("Search cursor does not match the requested archive.");
    }
    if (options.match !== undefined && options.match !== cursor.match) {
      throw new Error("Search cursor does not match the requested match mode.");
    }
    if (options.order !== undefined && options.order !== cursor.order) {
      throw new Error("Search cursor does not match the requested order.");
    }
    if (
      options.chapters !== undefined &&
      JSON.stringify(
        [...(options.chapters.length === 0 ? [] : options.chapters)].sort(
          compareNumbers,
        ),
      ) !== JSON.stringify([...(cursor.chapters ?? [])].sort(compareNumbers))
    ) {
      throw new Error(
        "Search cursor does not match the requested chapter scope.",
      );
    }
    if (
      options.types !== undefined &&
      JSON.stringify([...options.types].sort()) !==
        JSON.stringify([...(cursor.types ?? [])].sort())
    ) {
      throw new Error(
        "Search cursor does not match the requested result types.",
      );
    }
  }
  const { cursor: _cursor, ...optionsWithoutCursor } = options;
  const effectiveOptions: ArchiveFindOptions =
    cursor === undefined
      ? optionsWithoutCursor
      : {
          ...optionsWithoutCursor,
          ...(options.chapters !== undefined || cursor.chapters === null
            ? {}
            : { chapters: cursor.chapters }),
          match: options.match ?? cursor.match,
          order: options.order ?? cursor.order,
          queryMode: options.queryMode ?? cursor.queryMode,
          ...(options.types !== undefined || cursor.types === null
            ? {}
            : { types: cursor.types }),
        };
  const indexed = await findArchiveObjectsIndexed(
    document,
    query,
    effectiveOptions,
  );
  const hits = indexed?.hits ?? [];
  const ranked = createRankedFindResult(
    query,
    filterLexicalHitsByMatch(hits, search, effectiveOptions.match ?? "any"),
    effectiveOptions,
    indexed?.result.terms ?? search.terms,
  );
  const start = cursor?.offset ?? decodeFindCursor(options.cursor);
  const items = ranked.items.slice(start, start + ranked.limit);
  const nextOffset = start + items.length;
  const result: ArchiveFindResult = {
    ...ranked,
    items,
    nextCursor:
      nextOffset < ranked.items.length
        ? encodeTextSearchCursor({
            ...(effectiveOptions.archiveKey === undefined
              ? {}
              : { archiveKey: effectiveOptions.archiveKey }),
            chapters: ranked.chapters,
            match: ranked.match,
            offset: nextOffset,
            order: ranked.order,
            query: ranked.query,
            queryMode: effectiveOptions.queryMode ?? "hybrid",
            types: ranked.types,
          })
        : null,
  };

  return {
    ...result,
    items: await hydrateFindHitEvidence(document, result.items, {
      ...createFindEvidenceHydrationOptions(options),
      coalesceTextStreams: false,
      sourceContext: 0,
    }),
  };
}

async function createSearchRevisionScope(
  document: ReadonlyDocument,
  chapters: readonly number[] | undefined,
): Promise<string> {
  if (chapters === undefined || chapters.length === 0) {
    return JSON.stringify({
      chaptersRevision: await document.serials.getChaptersRevision(),
      searchIndexVersion: SEARCH_INDEX_VERSION,
      scope: "all",
    });
  }

  const uniqueChapters = [...new Set(chapters)].sort(compareNumbers);
  const revisions = await document.serials.getRevisions(uniqueChapters);

  return JSON.stringify({
    chapters: uniqueChapters.map(
      (chapterId) => [chapterId, revisions.get(chapterId) ?? 0] as const,
    ),
    searchIndexVersion: SEARCH_INDEX_VERSION,
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

  hits.push(...findMeta(await readArchiveMetaForQuery(document), search));
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
