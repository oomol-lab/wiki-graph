import type {
  ChunkRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlySerialTextStream,
  ReadonlyDocument,
  SentenceId,
} from "../../document/index.js";
import type { BookMeta } from "../../source/index.js";
import type { Document } from "../../document/index.js";
import {
  WikipageResolver,
  type WikipageResolverOptions,
} from "../../wikipage/index.js";
import type { QidResolution, WikipageSitelink } from "../../wikipage/index.js";

import {
  getGraphNode,
  listGraphNeighbors,
  type GraphNeighbor,
  type GraphNode,
} from "../../facade/graph.js";
import {
  getChapterTree,
  listChapters,
  type ChapterEntry,
} from "../../facade/chapter.js";
import {
  createLexicalQuery,
  listLexicalQueryCandidateTerms,
  createMentionLexicalHits,
  scoreLexicalText,
  type LexicalQuery,
} from "./lexical-search.js";
import {
  createEntitySearchSession,
  createSearchSession,
  decodeBucketSearchSessionCursor,
  decodeSearchSessionCursor,
  encodeBucketSearchSessionCursor,
  populateSearchSessionObjectCaches,
  readCachedEntitySearchSessionPage,
  readCachedSearchSessionPage,
  readEntitySearchEvidenceMentions,
  readEntitySearchSessionPage,
  readSearchSessionChunkBucketPage,
  readSearchSessionDescriptor,
  readSearchSessionMetadataForCursor,
  readSearchSessionObjectBucketPage,
  readSearchSessionPage,
  SEARCH_EVIDENCE_KIND,
  type BucketSearchCursor,
  type SearchChunkHitInput,
  type SearchChunkCursorKey,
  type SearchChapterTitleCursorKey,
  type SearchEntityHitInput,
  type SearchEvidenceHitEventInput,
  type SearchObjectCursorKey,
  type SearchSessionDescriptor,
  type SearchTextCursorKey,
  type SearchTripleHitInput,
} from "./search-cache.js";
import {
  createSearchIndexFingerprint,
  ensureSearchIndex,
  querySearchIndex,
  readSearchIndexStatus,
  SEARCH_INDEX_FTS_HIT_LIMIT,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexInput,
  type SearchIndexObjectHit,
  type SearchIndexProgressReporter,
  type SearchIndexQueryResult,
  type SearchIndexTextHit,
} from "../search-index/search-index.js";
import { WIKI_GRAPH_URI_PREFIX } from "../../common/wiki-graph-uri.js";
import {
  formatChapterId,
  formatChapterTitleId,
  formatEdgeId,
  formatFragmentId,
  formatNodeId,
  formatSummaryId,
  formatTextStreamRangeUri,
  parseArchiveReference,
  parseWikiGraphReference,
} from "./archive-view/references.js";
import type { WikiGraphReference } from "./archive-view/references.js";
import {
  DEFAULT_FIND_LIMIT,
  TEXT_ONLY_SEARCH_CACHE_WINDOW,
  ARCHIVE_ROOT_ID,
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
  BROAD_FIND_LENS_HINT,
  createPhraseSearch,
  matchText,
  createFindMatchFields,
  aggregateEvidenceScores,
  compareFindEvidenceHits,
  getSnippetNeedle,
  createFindResult,
  createRankedFindResult,
  mergeStringLists,
  createCollectionResult,
  compareListHits,
  createNodePosition,
  createSentencePosition,
  compareSentenceIds,
  compareArchivePositions,
  compareNumbers,
  parseFindLens,
  parseFindMatch,
  parseFindTypes,
  encodeFindCursor,
  decodeFindCursor,
  isFindCursor,
  createSnippet,
  formatMetaSummary,
  formatMetaTitle,
  createMetaPage,
  formatMetaText,
  formatWeight,
  isDefined,
} from "./archive-view/helpers.js";
import type { ArchiveTextSearch } from "./archive-view/helpers.js";
import type {
  ArchiveBacklinkBucket,
  ArchiveBacklinks,
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveEntityWikipageLocale,
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindHit,
  ArchiveFindMatch,
  ArchiveFindObjectType,
  ArchiveFindOptions,
  ArchiveFindOrder,
  ArchiveFindPosition,
  ArchiveFindResult,
  ArchiveIndex,
  ArchiveListItem,
  ArchiveListKind,
  ArchiveNodeLabel,
  ArchiveNodeSourceFragment,
  ArchivePack,
  ArchivePage,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
  ArchiveSourceFragment,
  ArchiveTextStreamIndex,
  ArchiveTextStreamKind,
  ArchiveTextStreamSentence,
  ChapterState,
  EntityEvidenceMention,
  EvidenceReadContext,
  PositionedNodeLabel,
  SourceEvidenceRange,
  TextStreamHitRange,
} from "./archive-view/types.js";

export {
  formatChapterId,
  formatEdgeId,
  formatNodeId,
  formatSummaryId,
} from "./archive-view/references.js";

export type {
  ArchiveBacklinkBucket,
  ArchiveBacklinks,
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveCollectionType,
  ArchiveEntityWikipageLocale,
  ArchiveEvidence,
  ArchiveEvidenceItem,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindField,
  ArchiveFindFilterType,
  ArchiveFindHit,
  ArchiveFindLens,
  ArchiveFindLensHint,
  ArchiveFindMatch,
  ArchiveFindObjectType,
  ArchiveFindOptions,
  ArchiveFindOrder,
  ArchiveFindPosition,
  ArchiveFindResult,
  ArchiveIndex,
  ArchiveListItem,
  ArchiveListKind,
  ArchiveNodeLabel,
  ArchiveNodeSourceFragment,
  ArchiveObjectType,
  ArchivePack,
  ArchivePage,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
  ArchiveSourceFragment,
  ArchiveTriplePattern,
} from "./archive-view/types.js";

const DEFAULT_SOURCE_CONTEXT = 2;

export interface ArchivePageOptions {
  readonly backlinks?: boolean;
  readonly evidenceLimit?: number;
  readonly order?: ArchiveFindOrder;
  readonly sourceContext?: number;
  readonly wikipageResolverOptions?: WikipageResolverOptions;
}

export async function getArchiveIndex(
  document: ReadonlyDocument,
): Promise<ArchiveIndex> {
  const [chapters, meta, nodes, edges] = await Promise.all([
    listChapters(document),
    document.readBookMeta(),
    document.chunks.countAll(),
    document.readingEdges.countAll(),
  ]);

  return {
    chapters,
    edgeCount: edges,
    meta,
    nodeCount: nodes,
    summaryCount: chapters.filter((chapter) => chapter.stage === "summarized")
      .length,
  };
}

export async function listArchiveObjects(
  document: ReadonlyDocument,
  kind: ArchiveListKind,
): Promise<readonly ArchiveListItem[]> {
  switch (kind) {
    case "chapters":
      return await Promise.all(
        (await listChapters(document)).map(async (chapter) => {
          const state = await createChapterState(document, chapter);

          return {
            id: formatChapterId(chapter.chapterId),
            label: chapter.title ?? "[untitled]",
            state,
            summary: formatChapterStateSummary(state),
            type: "chapter" as const,
          };
        }),
      );
    case "edges":
      return (await document.readingEdges.listAll()).map((edge) => ({
        id: formatEdgeId(edge),
        label: `${formatNodeId(edge.fromId)} -> ${formatNodeId(edge.toId)}`,
        summary: `weight ${formatWeight(edge.weight)}`,
        type: "edge",
      }));
    case "meta": {
      const meta = await document.readBookMeta();

      return [
        {
          id: ARCHIVE_ROOT_ID,
          label: formatMetaTitle(meta),
          summary: formatMetaSummary(meta),
          type: "meta",
        },
      ];
    }
    case "nodes":
      return (await document.chunks.listAll()).map((node) => ({
        id: formatNodeId(node.id),
        label: node.label,
        summary: node.content,
        type: "node",
      }));
    case "summaries":
      return (
        await Promise.all(
          (await listChapters(document)).map(async (chapter) => {
            const summary = await document.readSummary(chapter.chapterId);

            if (summary === undefined) {
              return undefined;
            }

            return {
              id: formatSummaryId(chapter.chapterId),
              label: chapter.title ?? `[chapter ${chapter.chapterId}]`,
              summary: createSnippet(summary),
              type: "summary" as const,
            };
          }),
        )
      ).filter(isDefined);
    case "fragments":
      return (
        await Promise.all(
          (await listChapters(document)).map(async (chapter) => {
            const title = chapter.title ?? formatChapterId(chapter.chapterId);

            return listTextStreamSentenceCollection(
              await createTextStreamIndex(
                document,
                chapter.chapterId,
                "source",
              ),
              chapter.chapterId,
              "source",
              title,
              chapter.documentOrder,
            ).map((hit) => ({
              id: hit.id,
              label: title,
              summary: hit.snippet,
              type: "source" as const,
            }));
          }),
        )
      ).flat();
  }
}

export async function listArchiveCollection(
  document: ReadonlyDocument,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  const items: ArchiveFindHit[] = [];
  const documentOrders = await document.serials.listDocumentOrders();
  const chapterFilter =
    options.chapters === undefined ? undefined : new Set(options.chapters);
  const types = options.types ?? [
    "meta",
    "chapter-title",
    "entity",
    "node",
    "triple",
  ];

  if (types.includes("meta")) {
    const meta = await document.readBookMeta();

    if (meta !== undefined) {
      items.push({
        field: "metadata",
        id: ARCHIVE_ROOT_ID,
        snippet: formatMetaSummary(meta),
        title: meta.title ?? "Archive metadata",
        type: "meta",
      });
    }
  }

  if (types.includes("chapter") || types.includes("chapter-title")) {
    for (const chapter of filterChapters(
      await listChapters(document),
      chapterFilter,
    )) {
      const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

      if (types.includes("chapter") || types.includes("chapter-title")) {
        items.push({
          chapter: chapter.chapterId,
          field: "title",
          id: formatChapterTitleId(chapter.chapterId),
          position: {
            chapter: chapter.chapterId,
            documentOrder: chapter.documentOrder,
          },
          snippet: title,
          title,
          type: "chapter-title",
        });
      }
    }
  }

  if (types.includes("node")) {
    for (const node of await document.chunks.listAll()) {
      if (!isChapterAllowed(chapterFilter, node.sentenceId[0])) {
        continue;
      }

      const position = createNodePosition(node.sentenceIds, documentOrders);

      items.push({
        chapter: node.sentenceId[0],
        field: "content",
        id: formatNodeId(node.id),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(node.content),
        title: node.label,
        type: "node",
      });
    }
  }

  if (types.includes("entity")) {
    items.push(
      ...listEntityCollection(
        filterMentionsByChapterSet(
          await listAllMentions(document),
          chapterFilter,
        ),
        documentOrders,
      ),
    );
  }

  if (types.includes("triple")) {
    items.push(
      ...(await listTripleCollection(document, chapterFilter, documentOrders)),
    );
  }

  const result = createCollectionResult(items, options);
  const evidenceItems = await hydrateFindHitEvidence(document, result.items, {
    ...(options.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: options.evidenceLimit }),
    order: options.order ?? "doc-asc",
    ...(options.sourceContext === undefined
      ? {}
      : { sourceContext: options.sourceContext }),
  });

  return {
    ...result,
    items: await hydrateFindHitBacklinks(document, evidenceItems, options),
  };
}

function filterChapters<T extends { readonly chapterId: number }>(
  chapters: readonly T[],
  chapterFilter: ReadonlySet<number> | undefined,
): readonly T[] {
  return chapterFilter === undefined
    ? chapters
    : chapters.filter((chapter) => chapterFilter.has(chapter.chapterId));
}

function isChapterAllowed(
  chapterFilter: ReadonlySet<number> | undefined,
  chapterId: number,
): boolean {
  return chapterFilter === undefined || chapterFilter.has(chapterId);
}

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

async function readBucketedSearchResultPage(
  document: ReadonlyDocument,
  cursor: {
    readonly createdAt: number;
    readonly cursor: BucketSearchCursor;
    readonly sessionId: string;
  },
  options: ArchiveFindOptions & { readonly limit: number },
): Promise<ArchiveFindResult> {
  const session = await readSearchSessionMetadataForCursor(
    cursor.sessionId,
    options.archiveKey ?? "archive",
    cursor.createdAt,
  );

  assertSearchCursorTypesMatch(options.types, session.types);

  const items: ArchiveFindHit[] = [];
  let bucketCursor: BucketSearchCursor | undefined = cursor.cursor;

  while (bucketCursor !== undefined && items.length < options.limit) {
    const remaining = options.limit - items.length;
    const page = await readBucketPage(
      document,
      session,
      bucketCursor,
      remaining,
    );

    items.push(...page.items);
    bucketCursor = page.nextCursor;
  }

  return await hydrateFindResultBacklinks(
    document,
    {
      chapters: session.chapters,
      items: await hydrateFindHitEvidence(
        document,
        items,
        createFindEvidenceHydrationOptions(options, cursor.sessionId),
      ),
      lens: parseFindLens(session.lens),
      lensHint: session.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
      limit: options.limit,
      match: parseFindMatch(session.match),
      nextCursor:
        bucketCursor === undefined
          ? null
          : encodeBucketSearchSessionCursor(
              cursor.sessionId,
              bucketCursor,
              session.createdAt,
            ),
      order: options.order ?? "doc-asc",
      query: session.query,
      terms: session.terms,
      types: parseFindTypes(session.types),
    },
    options,
  );
}

async function readBucketPage(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
  cursor: BucketSearchCursor,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  switch (cursor.bucket) {
    case 0:
      return await readChapterTitleBucketPage(
        document,
        session,
        cursor.key,
        limit,
      );
    case 1:
      return await readObjectBucketPage(document, session, cursor.key, limit);
    case 2:
      return await readChunkBucketPage(document, session, cursor.key, limit);
    case 3:
      return await readTextBucketPage(document, session, cursor.key, limit);
  }
}

async function readChapterTitleBucketPage(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
  after: SearchChapterTitleCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const result = await querySearchIndex(document, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
    match: parseFindMatch(session.match),
    objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
    textHitLimit: 0,
    types: ["chapter-title"],
  });
  const chapters = new Map(
    (await listChapters(document)).map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
  );
  const hits = (result?.objectHits ?? [])
    .filter(
      (hit) => hit.ownerKind === SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
    )
    .sort(compareChapterTitleIndexHits)
    .filter((hit) => isAfterChapterTitleKey(hit, after));
  const page = hits.slice(0, limit + 1);
  const hydrated = (
    await Promise.all(
      page.slice(0, limit).map(async (hit) => {
        const item = await hydrateSearchObjectHit(document, chapters, hit);

        return item === undefined
          ? undefined
          : withSearchTerms(item, session.terms);
      }),
    )
  ).filter(isDefined);
  const last = page.at(limit - 1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 0,
            key: {
              chapterId: parseSearchPropertyIntegerOwnerId(last.ownerId),
              score: last.score,
            },
          }
        : { bucket: 1 },
  };
}

async function readObjectBucketPage(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
  after: SearchObjectCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  if (!session.objectCachesPopulated) {
    await populateObjectBucketCaches(document, session);
  }
  const page = await readSearchSessionObjectBucketPage(
    session.sessionId,
    1,
    after,
    limit,
  );
  const items = page.slice(0, limit);
  const hydrated = await Promise.all(
    items.map(async (hit) => await hydrateCachedObjectBucketHit(document, hit)),
  );
  const last = items.at(-1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 1,
            key: {
              id: getObjectBucketCursorId(last),
              kind: last.type === "triple" ? "triple" : "entity",
              score: last.score ?? 0,
            },
          }
        : { bucket: 2 },
  };
}

async function populateObjectBucketCaches(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
): Promise<void> {
  const search = createLexicalQuery(session.query);

  if (search === undefined) {
    return;
  }

  const [allMentions, indexed] = await Promise.all([
    document.mentions.listBySurfaceTerms(
      listLexicalQueryCandidateTerms(session.query),
    ),
    querySearchIndex(document, session.query, {
      ...(session.chapters === null ? {} : { chapters: session.chapters }),
      match: parseFindMatch(session.match),
      objectHitLimit: SEARCH_INDEX_FTS_HIT_LIMIT,
      textHitLimit: 0,
      types: null,
    }),
  ]);
  const structuredHits = [
    ...findEntities(search, { mentions: allMentions }),
    ...(await findTriples(document, search, { mentions: allMentions })),
  ];
  const entityCacheInput = createEntitySearchCacheInput(
    structuredHits,
    indexed,
  );

  await populateSearchSessionObjectCaches({
    entityHits: entityCacheInput.entityHits,
    evidenceEvents: entityCacheInput.evidenceEvents,
    sessionId: session.sessionId,
  });
}

async function readChunkBucketPage(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
  after: SearchChunkCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const page = await readSearchSessionChunkBucketPage(
    session.sessionId,
    after,
    limit,
  );
  const items = page.slice(0, limit);
  const hydrated = (
    await Promise.all(
      items.map(
        async (hit) => await hydrateCachedChunkBucketHit(document, hit),
      ),
    )
  ).filter(isDefined);
  const last = items.at(-1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 2,
            key: {
              chunkId: parseSearchPropertyIntegerOwnerId(
                last.id.slice("wikg://chunk/".length),
              ),
              score: last.score ?? 0,
            },
          }
        : { bucket: 3 },
  };
}

async function readTextBucketPage(
  document: ReadonlyDocument,
  session: SearchSessionDescriptor,
  after: SearchTextCursorKey | undefined,
  limit: number,
): Promise<{
  readonly items: readonly ArchiveFindHit[];
  readonly nextCursor: BucketSearchCursor | undefined;
}> {
  const result = await querySearchIndex(document, session.query, {
    ...(session.chapters === null ? {} : { chapters: session.chapters }),
    match: parseFindMatch(session.match),
    objectHitLimit: 0,
    ...(after === undefined
      ? {}
      : {
          textAfter: {
            chapterId: after.chapterId,
            kind: after.kind as SearchIndexTextHit["kind"],
            rank: after.rank,
            sentenceIndex: after.sentenceIndex,
          },
        }),
    textHitLimit: createBucketQueryWindow(limit),
    types: ["source", "summary"],
  });
  const chapters = new Map(
    (await listChapters(document)).map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
  );
  const hits = [...(result?.textHits ?? [])]
    .sort(compareTextIndexHits)
    .filter((hit) => isAfterTextKey(hit, after));
  const page = hits.slice(0, limit + 1);
  const hydrated = (
    await Promise.all(
      page.slice(0, limit).map(async (hit) => {
        const item = await hydrateSearchTextHit(document, chapters, hit);

        return item === undefined
          ? undefined
          : withSearchTerms(item, session.terms);
      }),
    )
  ).filter(isDefined);
  const last = page.at(limit - 1);

  return {
    items: hydrated,
    nextCursor:
      page.length > limit && last !== undefined
        ? {
            bucket: 3,
            key: {
              chapterId: last.chapterId,
              kind: last.kind,
              rank: last.rank,
              sentenceIndex: last.sentenceIndex,
            },
          }
        : undefined,
  };
}

function createBucketQueryWindow(limit: number): number {
  return Math.max(limit + 1, limit * 3 + 1, 100);
}

async function hydrateCachedObjectBucketHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit> {
  if (hit.type === "entity") {
    const qid = parseEntityQid(hit.id);

    if (qid === undefined) {
      return hit;
    }
    const mentions = await document.mentions.listByQid(qid);
    const [first] = [...mentions].sort(compareMentions);

    if (first === undefined) {
      return hit;
    }

    return {
      ...hit,
      chapter: first.chapterId,
      position: {
        chapter: first.chapterId,
        sentence: first.sentenceIndex ?? 0,
      },
      snippet: first.note ?? first.surface,
      title: selectEntityLabel(mentions),
    };
  }
  if (hit.type === "triple") {
    return hit;
  }

  return hit;
}

async function hydrateCachedChunkBucketHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit | undefined> {
  const chunkId = parseSearchPropertyIntegerOwnerId(
    hit.id.slice("wikg://chunk/".length),
  );
  const node = await document.chunks.getById(chunkId);

  if (node === undefined) {
    return undefined;
  }
  const { position: _position, ...baseHit } = hit;
  const position = createNodePosition(node.sentenceIds);

  return {
    ...baseHit,
    chapter: node.sentenceId[0],
    field: "title",
    ...(position === undefined ? {} : { position }),
    snippet: createSnippet(node.content),
    title: node.label,
  };
}

function compareChapterTitleIndexHits(
  left: SearchIndexObjectHit,
  right: SearchIndexObjectHit,
): number {
  return (
    compareNumbers(right.score, left.score) ||
    compareNumbers(
      parseSearchPropertyIntegerOwnerId(left.ownerId),
      parseSearchPropertyIntegerOwnerId(right.ownerId),
    )
  );
}

function compareTextIndexHits(
  left: SearchIndexTextHit,
  right: SearchIndexTextHit,
): number {
  return (
    compareNumbers(left.rank, right.rank) ||
    compareNumbers(left.chapterId, right.chapterId) ||
    compareNumbers(left.sentenceIndex, right.sentenceIndex) ||
    compareNumbers(left.kind, right.kind)
  );
}

function isAfterChapterTitleKey(
  hit: SearchIndexObjectHit,
  key: SearchChapterTitleCursorKey | undefined,
): boolean {
  if (key === undefined) {
    return true;
  }

  return (
    compareChapterTitleIndexHits(
      {
        ...hit,
        ownerId: String(key.chapterId),
        score: key.score,
      },
      hit,
    ) < 0
  );
}

function isAfterTextKey(
  hit: SearchIndexTextHit,
  key: SearchTextCursorKey | undefined,
): boolean {
  if (key === undefined) {
    return true;
  }

  return (
    compareTextIndexHits(
      {
        chapterId: key.chapterId,
        kind: key.kind as SearchIndexTextHit["kind"],
        rank: key.rank,
        score: 0,
        sentenceIndex: key.sentenceIndex,
        wordsCount: 0,
      },
      hit,
    ) < 0
  );
}

function getObjectBucketCursorId(hit: ArchiveFindHit): string {
  if (hit.type !== "triple") {
    return hit.id.replace(/^wikg:\/\/entity\//u, "");
  }

  const triple = parseTripleCursorId(hit.id);

  return triple ?? hit.id;
}

function parseTripleCursorId(id: string): string | undefined {
  const match = /^wikg:\/\/triple\/([^/]+)\/([^/]+)\/([^/]+)$/u.exec(id);

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  return `${match[1]}\u001f${decodeURIComponent(match[2])}\u001f${match[3]}`;
}

function tryDecodeBucketSearchSessionCursor(cursor: string):
  | {
      readonly createdAt: number;
      readonly cursor: BucketSearchCursor;
      readonly sessionId: string;
    }
  | undefined {
  try {
    return decodeBucketSearchSessionCursor(cursor);
  } catch {
    return undefined;
  }
}

export async function rebuildArchiveSearchIndex(
  document: Document,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const input = await createSearchIndexRecords(document, progress);

  if ((await readSearchIndexStatus(document, input)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }

  await ensureSearchIndex(document, input, progress);
}

export async function isArchiveSearchIndexCurrent(
  document: ReadonlyDocument,
): Promise<boolean> {
  return (await readArchiveSearchIndexStatus(document)) === "current";
}

export async function readArchiveSearchIndexStatus(
  document: ReadonlyDocument,
): Promise<"current" | "dirty" | "missing"> {
  return await readSearchIndexStatus(
    document,
    await createSearchIndexRecords(document),
  );
}

export async function clearDirtyArchiveSearchIndex(
  document: Document,
): Promise<void> {
  if ((await readArchiveSearchIndexStatus(document)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }
}

export async function createArchiveSearchIndexFingerprint(
  document: ReadonlyDocument,
): Promise<string> {
  return createSearchIndexFingerprint(await createSearchIndexRecords(document));
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

async function findArchiveObjectsIndexed(
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

async function queryRequiredSearchIndex(
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

async function hydrateSearchIndexHits(
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

function createSearchIndexHydrationOptions(options: ArchiveFindOptions): {
  readonly textHitLimit?: number;
} {
  if (!isTextOnlySearch(options) || options.limit === undefined) {
    return {};
  }

  return { textHitLimit: createTextOnlySearchCacheWindow(options.limit) };
}

function createSearchIndexQueryLimitOptions(options: ArchiveFindOptions): {
  readonly textHitLimit?: number;
} {
  if (!isTextOnlySearch(options) || options.limit === undefined) {
    return {};
  }

  return { textHitLimit: createTextOnlySearchCacheWindow(options.limit) };
}

function createTextOnlySearchCacheWindow(limit: number): number {
  return Math.max(limit + 1, TEXT_ONLY_SEARCH_CACHE_WINDOW);
}

function isTextOnlySearch(options: ArchiveFindOptions): boolean {
  return (
    options.types !== undefined &&
    options.types.length > 0 &&
    options.types.every((type) => type === "source" || type === "summary")
  );
}

function withSearchTerms(
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

async function hydrateSearchObjectHit(
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

      const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

      return {
        chapter: chapter.chapterId,
        field: "title",
        id: formatChapterTitleId(chapter.chapterId),
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

function parseSearchPropertyIntegerOwnerId(ownerId: string): number {
  const value = Number(ownerId);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid search property owner id: ${ownerId}`);
  }

  return value;
}

async function hydrateSearchTextHit(
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
    id: range.id,
    matchCount: 1,
    position: {
      chapter: hit.chapterId,
      sentence: hit.sentenceIndex,
    },
    score: hit.score,
    snippet: createSnippet(range.text),
    title: chapter.title ?? `[chapter ${hit.chapterId}]`,
    type: stream,
  };
}

async function createSearchIndexRecords(
  document: ReadonlyDocument,
  progress?: SearchIndexProgressReporter,
): Promise<SearchIndexInput> {
  const objectProperties: SearchIndexInput["objectProperties"][number][] = [];
  const textSentences: SearchIndexInput["textSentences"][number][] = [];
  const chapters = await listChapters(document);
  let chapterDone = 0;

  for (const chapter of chapters) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

    objectProperties.push({
      chapterId: chapter.chapterId,
      ownerId: String(chapter.chapterId),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
      text: title,
    });

    textSentences.push(
      ...(await createTextStreamSearchIndexRecords(
        document,
        chapter.chapterId,
        "summary",
        title,
      )),
    );
    textSentences.push(
      ...(await createTextStreamSearchIndexRecords(
        document,
        chapter.chapterId,
        "source",
        title,
      )),
    );
    chapterDone += 1;
    await progress?.({
      done: chapterDone,
      phase: "collecting",
      total: chapters.length,
      unit: "chapter",
    });
  }

  for (const node of await document.chunks.listAll()) {
    objectProperties.push({
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
      text: node.label,
    });
    objectProperties.push({
      chapterId: node.sentenceId[0],
      ownerId: String(node.id),
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
      text: node.content,
    });
  }

  for (const mention of await document.mentions.listAll()) {
    objectProperties.push({
      chapterId: mention.chapterId,
      ownerId: mention.qid,
      ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
      propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
      text: mention.surface,
    });
  }

  return { objectProperties, textSentences };
}

async function createTextStreamSearchIndexRecords(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  _title: string,
): Promise<SearchIndexInput["textSentences"]> {
  const index = await createTextStreamIndex(document, chapterId, stream);

  return index.sentences.map((sentence) => ({
    chapterId,
    kind:
      stream === "source"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary,
    sentenceIndex: sentence.globalIndex,
    text: sentence.text,
    wordsCount: sentence.wordsCount,
  }));
}

export async function readArchiveText(
  document: ReadonlyDocument,
  id: string,
): Promise<string> {
  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter":
      throw new Error(
        `Chapter ${formatChapterId(reference.id)} is a scope URI, not a readable object.`,
      );
    case "chapter-title": {
      const chapter = await requireChapter(document, reference.id);

      return chapter.title ?? `[chapter ${reference.id}]`;
    }
    case "fragment":
      return (
        await readSourceFragment(
          document,
          reference.serialId,
          reference.fragmentId,
        )
      ).text;
    case "summary": {
      const summary = await readTextStreamText(
        document,
        reference.id,
        "summary",
      );

      if (summary.trim() === "") {
        throw new Error(`Summary ${formatSummaryId(reference.id)} is missing.`);
      }

      return summary;
    }
    case "node": {
      const { node } = await requireNode(document, reference.id);

      return node.content;
    }
    case "meta": {
      return formatMetaText(await document.readBookMeta());
    }
  }
}

export async function readArchivePage(
  document: ReadonlyDocument,
  id: string,
  options: ArchivePageOptions = {},
): Promise<ArchivePage> {
  if (isWikiGraphObjectUri(id)) {
    return await readWikiGraphPage(
      document,
      normalizeWikiGraphObjectUri(id),
      options,
    );
  }

  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter": {
      throw new Error(
        `Chapter ${formatChapterId(reference.id)} is a scope URI, not a readable object. Use wikg://chapter/${reference.id}/title or wikg://chapter/${reference.id}/state.`,
      );
    }
    case "chapter-title": {
      const chapter = await requireChapter(document, reference.id);

      return {
        id: formatChapterTitleId(reference.id),
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "chapter-title",
      };
    }
    case "fragment": {
      const [fragment, relatedNodes, fragmentIds] = await Promise.all([
        readSourceFragment(document, reference.serialId, reference.fragmentId),
        listFragmentNodes(document, reference.serialId, reference.fragmentId),
        document.getSerialFragments(reference.serialId).listFragmentIds(),
      ]);
      const fragmentIndex = fragmentIds.indexOf(reference.fragmentId);
      const previousFragmentId =
        fragmentIndex > 0 ? fragmentIds[fragmentIndex - 1] : undefined;
      const nextFragmentId =
        fragmentIndex >= 0 && fragmentIndex < fragmentIds.length - 1
          ? fragmentIds[fragmentIndex + 1]
          : undefined;

      return {
        fragment,
        id: fragment.id,
        nextFragmentId:
          nextFragmentId === undefined
            ? undefined
            : formatFragmentId(reference.serialId, nextFragmentId),
        nodes: relatedNodes,
        previousFragmentId:
          previousFragmentId === undefined
            ? undefined
            : formatFragmentId(reference.serialId, previousFragmentId),
        title: fragment.id,
        type: "fragment",
      };
    }
    case "meta":
      return {
        ...createMetaPage(await document.readBookMeta()),
        id: ARCHIVE_ROOT_ID,
        type: "meta",
      };
    case "node": {
      const { chapterId, node } = await requireNode(document, reference.id);
      const [neighbors, sourceFragments] = await Promise.all([
        listGraphNeighbors(document, chapterId, reference.id),
        readNodeSourceFragments(document, node),
      ]);
      const outgoing = neighbors.filter(
        (neighbor) => neighbor.direction === "outgoing",
      );
      const incoming = neighbors.filter(
        (neighbor) => neighbor.direction === "incoming",
      );

      return {
        generatedNodeSummary: node.content,
        id: formatNodeId(node.id),
        incoming,
        neighbors,
        outgoing,
        position: createNodePosition(node.sentenceIds),
        sourceFragments,
        title: node.label,
        type: "node",
      };
    }
    case "summary": {
      const chapter = await requireChapter(document, reference.id);
      const content = await readTextStreamText(
        document,
        reference.id,
        "summary",
      );

      if (content.trim() === "") {
        throw new Error(`Summary ${formatSummaryId(reference.id)} is missing.`);
      }

      return {
        content,
        id: formatSummaryId(reference.id),
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "summary",
      };
    }
  }
}

async function readWikiGraphPage(
  document: ReadonlyDocument,
  uri: string,
  options: ArchivePageOptions = {},
): Promise<ArchivePage> {
  uri = normalizeWikiGraphObjectUri(uri);
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "meta":
      return await readArchivePage(document, ARCHIVE_ROOT_ID, options);
    case "chapter":
      throw new Error(
        `wikg://chapter/${reference.chapterId} is a scope URI, not a readable object. Use wikg://chapter/${reference.chapterId}/title or wikg://chapter/${reference.chapterId}/state.`,
      );
    case "chapter-title":
      return await readArchivePage(
        document,
        formatChapterTitleId(reference.chapterId),
        options,
      );
    case "chapter-state": {
      const details = await requireChapter(document, reference.chapterId);
      const targets = await createChapterState(document, details);

      return {
        id:
          reference.target === undefined
            ? `wikg://chapter/${reference.chapterId}/state`
            : `wikg://chapter/${reference.chapterId}/state/${reference.target}`,
        ...(reference.target === undefined
          ? { state: targets }
          : { target: reference.target, value: targets[reference.target] }),
        type: "state",
      };
    }
    case "chapter-tree":
      return {
        id: "chapter-tree",
        title: "Chapter tree",
        tree: await getChapterTree(document),
        type: "chapter-tree",
      };
    case "entity": {
      const mentions = filterMentionsByChapter(
        await document.mentions.listByQid(reference.qid),
        reference.chapterId,
      );

      if (mentions.length === 0) {
        throw new Error(`Entity ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionEvidencePreview(
          document,
          mentions,
          options.evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        ),
        id: uri,
        label: selectEntityLabel(mentions),
        labels: selectEntityLabels(mentions),
        mentionCount: mentions.length,
        qid: reference.qid,
        type: "entity",
      };
    }
    case "entity-wikipage":
      return {
        ...(await resolveEntityWikipage(reference.qid, options)),
        id: uri,
        type: "entity-wikipage",
      };
    case "triple": {
      const links = await filterMentionLinksByChapter(
        document,
        await document.mentionLinks.listByTriple({
          objectQid: reference.objectQid,
          predicate: reference.predicate,
          subjectQid: reference.subjectQid,
        }),
        reference.chapterId,
      );

      if (links.length === 0) {
        throw new Error(`Triple ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionLinkEvidencePreview(
          document,
          links,
          options.evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        ),
        id: uri,
        label: await createTriplePageLabel(document, reference),
        objectQid: reference.objectQid,
        predicate: reference.predicate,
        subjectQid: reference.subjectQid,
        type: "triple",
      };
    }
    case "chunk": {
      if (reference.chapterId !== undefined) {
        const { chapterId } = await requireNode(document, reference.id);

        if (chapterId !== reference.chapterId) {
          throw new Error(`Chunk ${uri} was not found in this archive.`);
        }
      }
      return await readArchivePage(
        document,
        formatNodeId(reference.id),
        options,
      );
    }
    case "text-stream":
      return {
        ...(options.backlinks === true
          ? { backlinks: await createTextStreamBacklinks(document, reference) }
          : {}),
        fragment: await createTextStreamRangeFragment(document, reference),
        id: uri,
        nextFragmentId: undefined,
        nodes: [],
        previousFragmentId: undefined,
        title: uri,
        type: "fragment",
      };
  }
}

export async function listArchiveLinks(
  document: ReadonlyDocument,
  id: string,
  direction: "backlinks" | "links",
): Promise<readonly GraphNeighbor[]> {
  return (await listAllArchiveLinks(document, id)).filter((neighbor) =>
    direction === "links"
      ? neighbor.direction === "outgoing"
      : neighbor.direction === "incoming",
  );
}

export async function listAllArchiveLinks(
  document: ReadonlyDocument,
  id: string,
): Promise<readonly GraphNeighbor[]> {
  if (isWikiGraphObjectUri(id)) {
    id = normalizeWikiGraphObjectUri(id);
    const reference = parseWikiGraphReference(id);

    if (reference.type !== "chunk") {
      return [];
    }

    const { chapterId } = await requireNode(document, reference.id);

    if (
      reference.chapterId !== undefined &&
      reference.chapterId !== chapterId
    ) {
      throw new Error(`Chunk ${id} was not found in this archive.`);
    }

    return await listGraphNeighbors(document, chapterId, reference.id);
  }

  const reference = parseArchiveReference(id);

  if (reference.type !== "node") {
    return [];
  }

  const { chapterId } = await requireNode(document, reference.id);
  return await listGraphNeighbors(document, chapterId, reference.id);
}

export async function listRelatedArchiveObjects(
  document: ReadonlyDocument,
  id: string,
  options: ArchiveRelatedOptions = {},
): Promise<ArchiveRelatedResult> {
  if (isWikiGraphObjectUri(id)) {
    return await listRelatedWikiGraphObjects(
      document,
      normalizeWikiGraphObjectUri(id),
      options,
    );
  }

  const reference = parseArchiveReference(id);
  if (reference.type !== "node") {
    rejectRelatedRole(options.role, id);
    return paginateRelatedItems([], options);
  }
  rejectRelatedRole(options.role, id);

  const documentOrders = await document.serials.listDocumentOrders();
  const { chapterId } = await requireNode(document, reference.id);
  const items = sortGraphNeighborsByListMode(
    await listGraphNeighbors(document, chapterId, reference.id),
    documentOrders,
    options.order ?? "doc-asc",
  ).map((neighbor) => ({
    id: formatNodeId(neighbor.node.id),
    label: neighbor.node.label,
    summary: neighbor.node.content,
    type: "node" as const,
  }));

  return await hydrateRelatedItemsEvidence(
    document,
    await filterAndSortChunkRelatedItemsByQuery(document, items, options.query),
    options,
  );
}

async function listRelatedWikiGraphObjects(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter": {
      throw new Error(`Related is not available for scope URI: ${uri}`);
    }
    case "chapter-title":
      rejectRelatedRole(options.role, uri);
      return paginateRelatedItems([], options);
    case "chunk": {
      rejectRelatedRole(options.role, uri);
      const { chapterId } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }

      const items = sortGraphNeighborsByListMode(
        await listGraphNeighbors(document, chapterId, reference.id),
        await document.serials.listDocumentOrders(),
        options.order ?? "doc-asc",
      ).map((neighbor) => ({
        id: formatNodeId(neighbor.node.id),
        label: neighbor.node.label,
        summary: neighbor.node.content,
        type: "node" as const,
      }));

      return await hydrateRelatedItemsEvidence(
        document,
        await filterAndSortChunkRelatedItemsByQuery(
          document,
          items,
          options.query,
        ),
        options,
      );
    }
    case "text-stream": {
      rejectRelatedQuery(options.query, uri);
      rejectRelatedRole(options.role, uri);
      const chapter = await requireChapter(document, reference.chapterId);

      return await hydrateRelatedItemsEvidence(
        document,
        [
          {
            id: formatChapterId(reference.chapterId),
            label: chapter.title ?? `[chapter ${reference.chapterId}]`,
            summary: `${chapter.stage}; ${chapter.fragmentCount} fragments`,
            type: "chapter",
          },
        ],
        options,
      );
    }
    case "entity":
      return await listRelatedEntityObjects(document, reference, options);
    case "triple":
      throw new Error(
        `Related is only available for chunk and entity objects: ${uri}`,
      );
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "chapter-state":
      rejectRelatedQuery(options.query, uri);
      rejectRelatedRole(options.role, uri);
      return paginateRelatedItems([], options);
  }
}

async function resolveEntityWikipage(
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

  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(
    sitelink.title.replace(/ /gu, "_"),
  )}`;
}

async function listRelatedEntityObjects(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "entity" }>,
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const mentions = filterMentionsByChapter(
    await document.mentions.listByQid(reference.qid),
    reference.chapterId,
  );

  if (mentions.length === 0) {
    throw new Error(
      `Entity ${formatEntityUri(reference.qid)} was not found in this archive.`,
    );
  }

  const chapters = [
    ...new Set(mentions.map((mention) => mention.chapterId)),
  ].sort(compareNumbers);
  const role = options.role ?? "any";
  const triplesById = new Map<
    string,
    Extract<ArchiveListItem, { readonly type: "triple" }>
  >();

  for (const chapterId of chapters) {
    for (const link of await document.mentionLinks.listByChapter(chapterId)) {
      const [source, target] = await Promise.all([
        document.mentions.getById(link.sourceMentionId),
        document.mentions.getById(link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }
      if (
        !matchesRelatedEntityRole(source.qid, target.qid, reference.qid, role)
      ) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);

      const existing = triplesById.get(id);

      if (existing !== undefined) {
        triplesById.set(id, {
          ...existing,
          evidenceLinks: [...(existing.evidenceLinks ?? []), link],
        });
        continue;
      }

      triplesById.set(id, {
        evidenceLinks: [link],
        id,
        label: `${source.surface} ${link.predicate} ${target.surface}`,
        objectLabel: target.surface,
        objectQid: target.qid,
        predicate: link.predicate,
        subjectLabel: source.surface,
        subjectQid: source.qid,
        summary: `${source.qid} ${link.predicate} ${target.qid}`,
        type: "triple",
      });
    }
  }

  return await hydrateRelatedItemsEvidence(
    document,
    await filterAndSortEntityRelatedTriplesByQuery(
      document,
      sortRelatedItemsByListMode(
        [...triplesById.values()],
        options.order ?? "doc-asc",
        await document.serials.listDocumentOrders(),
      ),
      reference.qid,
      options.query,
    ),
    options,
  );
}

async function filterAndSortChunkRelatedItemsByQuery(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  query: string | undefined,
): Promise<readonly ArchiveListItem[]> {
  if (query === undefined) {
    return items;
  }

  const indexResult = await queryRequiredSearchIndex(document, query, {
    types: ["node"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const scoresByChunkId = new Map<number, number[]>();
  const allowedChunkIds = new Set(
    items.flatMap((item) => {
      if (item.type !== "node") {
        return [];
      }
      const reference = parseArchiveReference(item.id);

      return reference.type === "node" ? [reference.id] : [];
    }),
  );

  for (const hit of indexResult.objectHits) {
    if (
      hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk ||
      !allowedChunkIds.has(Number(hit.ownerId))
    ) {
      continue;
    }

    const chunkId = Number(hit.ownerId);
    const scores = scoresByChunkId.get(chunkId) ?? [];

    scores.push(hit.score);
    scoresByChunkId.set(chunkId, scores);
  }

  return items
    .flatMap((item) => {
      if (item.type !== "node") {
        return [];
      }
      const reference = parseArchiveReference(item.id);

      if (reference.type !== "node") {
        return [];
      }
      const scores = scoresByChunkId.get(reference.id);

      return scores === undefined
        ? []
        : [{ ...item, score: aggregateEvidenceScores(scores) }];
    })
    .sort(compareRelatedQueryItems);
}

async function filterAndSortEntityRelatedTriplesByQuery(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  anchorQid: string,
  query: string | undefined,
): Promise<readonly ArchiveListItem[]> {
  if (query === undefined) {
    return items;
  }
  const scope = await createEntityRelatedQueryScope(document, items, anchorQid);

  const indexResult = await queryRequiredSearchIndex(document, query, {
    chapters: [...scope.chapterIds],
    types: ["entity", "source"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const sentenceScores = new Map(
    indexResult.textHits
      .filter((hit) => hit.kind === TEXT_SENTENCE_KIND.source)
      .map(
        (hit) =>
          [
            createSentenceHitKey(hit.chapterId, hit.sentenceIndex),
            hit.score,
          ] as const,
      ),
  );
  const endpointScoresByKey = new Map<string, number[]>();

  for (const hit of indexResult.objectHits) {
    if (
      hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity ||
      hit.ownerId === anchorQid ||
      hit.chapterId === undefined
    ) {
      continue;
    }

    const key = createEntityRelatedEndpointKey(hit.ownerId, hit.chapterId);
    const scores = endpointScoresByKey.get(key) ?? [];

    scores.push(hit.score);
    endpointScoresByKey.set(key, scores);
  }

  return items
    .flatMap((item) => {
      if (item.type !== "triple") {
        return [];
      }

      const scores = [
        ...[...(scope.endpointKeysByTripleId.get(item.id) ?? [])].flatMap(
          (key) => endpointScoresByKey.get(key) ?? [],
        ),
        ...(item.evidenceLinks ?? []).flatMap((link) =>
          link.evidenceSentenceIds.flatMap(([chapterId, sentenceIndex]) => {
            const score = sentenceScores.get(
              createSentenceHitKey(chapterId, sentenceIndex),
            );

            return score === undefined ? [] : [score];
          }),
        ),
      ];

      return scores.length === 0
        ? []
        : [{ ...item, score: aggregateEvidenceScores(scores) }];
    })
    .sort(compareRelatedQueryItems);
}

async function createEntityRelatedQueryScope(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  anchorQid: string,
): Promise<{
  readonly chapterIds: ReadonlySet<number>;
  readonly endpointKeysByTripleId: ReadonlyMap<string, ReadonlySet<string>>;
}> {
  const chapterIds = new Set<number>();
  const endpointKeysByTripleId = new Map<string, Set<string>>();
  const mentionCache = new Map<string, MentionRecord | undefined>();

  for (const item of items) {
    if (item.type !== "triple") {
      continue;
    }

    const endpointKeys = new Set<string>();

    for (const link of item.evidenceLinks ?? []) {
      for (const [chapterId] of link.evidenceSentenceIds) {
        chapterIds.add(chapterId);
      }

      const [source, target] = await Promise.all([
        getCachedMention(document, mentionCache, link.sourceMentionId),
        getCachedMention(document, mentionCache, link.targetMentionId),
      ]);

      for (const mention of [source, target]) {
        if (mention === undefined || mention.qid === anchorQid) {
          continue;
        }

        chapterIds.add(mention.chapterId);
        endpointKeys.add(
          createEntityRelatedEndpointKey(mention.qid, mention.chapterId),
        );
      }
    }

    endpointKeysByTripleId.set(item.id, endpointKeys);
  }

  return { chapterIds, endpointKeysByTripleId };
}

async function getCachedMention(
  document: ReadonlyDocument,
  cache: Map<string, MentionRecord | undefined>,
  mentionId: string,
): Promise<MentionRecord | undefined> {
  if (!cache.has(mentionId)) {
    cache.set(mentionId, await document.mentions.getById(mentionId));
  }

  return cache.get(mentionId);
}

function createEntityRelatedEndpointKey(
  qid: string,
  chapterId: number,
): string {
  return `${qid}:${chapterId}`;
}

function compareRelatedQueryItems(
  left: ArchiveListItem,
  right: ArchiveListItem,
): number {
  const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

  if (scoreComparison !== 0) {
    return scoreComparison;
  }

  return compareListHits(
    createFindHitFromListItem(left),
    createFindHitFromListItem(right),
    "doc-asc",
  );
}

function sortRelatedItemsByListMode(
  items: readonly ArchiveListItem[],
  order: ArchiveFindOrder = "doc-asc",
  documentOrders?: ReadonlyMap<number, number>,
): readonly ArchiveListItem[] {
  return [...items].sort((left, right) =>
    compareListHits(
      createFindHitFromListItem(left, documentOrders),
      createFindHitFromListItem(right, documentOrders),
      order,
    ),
  );
}

function sortGraphNeighborsByListMode(
  neighbors: readonly GraphNeighbor[],
  documentOrders: ReadonlyMap<number, number>,
  order: ArchiveFindOrder,
): readonly GraphNeighbor[] {
  const direction = order === "doc-asc" ? 1 : -1;

  return [...neighbors].sort(
    (left, right) =>
      compareSentenceIds(
        getFirstGraphNodeSentenceId(left.node),
        getFirstGraphNodeSentenceId(right.node),
        documentOrders,
      ) * direction,
  );
}

function createFindHitFromListItem(
  item: ArchiveListItem,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindHit {
  const position = createListItemPosition(item, documentOrders);
  const score =
    item.type === "triple" ? (item.evidenceLinks?.length ?? 0) : undefined;

  return {
    field: "title",
    id: item.id,
    ...(position === undefined ? {} : { position }),
    ...(score === undefined ? {} : { score }),
    snippet: item.summary,
    title: item.label,
    type: toFindObjectType(item.type),
  };
}

function toFindObjectType(
  type: ArchiveListItem["type"],
): ArchiveFindObjectType {
  switch (type) {
    case "edge":
    case "state":
      return "meta";
    default:
      return type;
  }
}

function createListItemPosition(
  item: ArchiveListItem,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  if (item.type === "triple") {
    return createFirstMentionLinkPosition(
      item.evidenceLinks ?? [],
      documentOrders,
    );
  }

  return undefined;
}

function createFirstMentionLinkPosition(
  links: readonly MentionLinkRecord[],
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  const sentenceIds = links.flatMap((link) => link.evidenceSentenceIds);
  const [first] = sentenceIds.sort((left, right) =>
    compareSentenceIds(left, right, documentOrders),
  );

  return first === undefined
    ? undefined
    : createSentencePosition(first, documentOrders);
}

function getFirstGraphNodeSentenceId(node: GraphNode): SentenceId {
  return (
    [...node.sentenceIds].sort(compareSentenceIds)[0] ?? [
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]
  );
}

function matchesRelatedEntityRole(
  subjectQid: string,
  objectQid: string,
  qid: string,
  role: ArchiveRelatedRole,
): boolean {
  const isSubject = subjectQid === qid;
  const isObject = objectQid === qid;
  const isSelf = isSubject && isObject;

  switch (role) {
    case "any":
      return isSubject || isObject;
    case "subject":
      return isSubject && !isSelf;
    case "object":
      return isObject && !isSelf;
    case "self":
      return isSelf;
  }
}

function rejectRelatedRole(
  role: ArchiveRelatedRole | undefined,
  id: string,
): void {
  if (role !== undefined && role !== "any") {
    throw new Error(`--role is only available for entity related: ${id}`);
  }
}

function rejectRelatedQuery(query: string | undefined, id: string): void {
  if (query !== undefined) {
    throw new Error(
      `Related query is only available for chunk and entity: ${id}`,
    );
  }
}

async function hydrateRelatedItemsEvidence(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const page = paginateRelatedItems(items, options);

  if (options.evidenceLimit === undefined) {
    return {
      ...page,
      items: page.items.map((item) => {
        if (item.type !== "triple") {
          return item;
        }
        const { evidenceLinks: _evidenceLinks, ...publicItem } = item;
        return publicItem;
      }),
    };
  }

  const context = createEvidenceReadContext();
  const evidenceLimit = options.evidenceLimit;

  return {
    ...page,
    items: await Promise.all(
      page.items.map(async (item) => {
        if (item.evidence !== undefined) {
          return item;
        }
        if (item.type === "triple") {
          const evidence = await createMentionLinkEvidencePreview(
            document,
            item.evidenceLinks ?? [],
            evidenceLimit,
            context,
            options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
            options.order ?? "doc-asc",
          );
          const { evidenceLinks: _evidenceLinks, ...publicItem } = item;

          return { ...publicItem, evidence };
        }
        if (item.type === "node") {
          const reference = parseArchiveReference(item.id);

          if (reference.type !== "node") {
            return item;
          }

          const { node } = await requireNode(document, reference.id);
          return {
            ...item,
            evidence: await createSourceEvidencePreview(
              document,
              createNodeEvidenceRanges(node),
              evidenceLimit,
              context,
              options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
              options.order ?? "doc-asc",
            ),
          };
        }
        return item;
      }),
    ),
  };
}

function paginateRelatedItems(
  items: readonly ArchiveListItem[],
  options: ArchiveRelatedOptions,
): ArchiveRelatedResult {
  const limit = options.limit ?? 20;
  const offset = parseRelatedCursor(options.cursor);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    limit,
    nextCursor: nextOffset >= items.length ? null : String(nextOffset),
  };
}

function parseRelatedCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^(0|[1-9][0-9]*)$/u.test(cursor)) {
    throw new Error(`Invalid related cursor: ${cursor}`);
  }

  return Number(cursor);
}

export async function listArchiveEvidence(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter":
    case "chapter-title":
    case "chapter-state":
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "text-stream":
      throw new Error(`Evidence is not available for ${uri}.`);
    case "chunk": {
      const { chapterId, node } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }

      return await createSourceEvidencePage(
        document,
        createNodeEvidenceRanges(node),
        options,
      );
    }
    case "entity":
      return await createSourceEvidencePage(
        document,
        await createMentionEvidenceRanges(
          document,
          filterMentionsByChapter(
            await document.mentions.listByQid(reference.qid),
            reference.chapterId,
          ),
        ),
        options,
      );
    case "triple":
      return await createSourceEvidencePage(
        document,
        createMentionLinkEvidenceRanges(
          document,
          await filterMentionLinksByChapter(
            document,
            await document.mentionLinks.listByTriple({
              objectQid: reference.objectQid,
              predicate: reference.predicate,
              subjectQid: reference.subjectQid,
            }),
            reference.chapterId,
          ),
        ),
        options,
      );
  }
}

export async function packArchiveContext(
  document: ReadonlyDocument,
  id: string,
  budget: number,
): Promise<ArchivePack> {
  validatePackReference(id);

  const [anchor, related] = await Promise.all([
    readArchivePage(document, id, { evidenceLimit: 3 }),
    listRelatedArchiveObjects(document, id, { evidenceLimit: 3 }),
  ]);

  return {
    anchor,
    budget,
    related: related.items,
  };
}

function validatePackReference(id: string): void {
  const reference = parseWikiGraphReference(id);

  switch (reference.type) {
    case "chunk":
    case "entity":
      return;
    case "chapter":
    case "chapter-title":
    case "chapter-state":
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "text-stream":
      throw new Error(
        `Pack is only available for chunk and entity objects: ${id}`,
      );
  }
}

function findEntities(
  search: LexicalQuery,
  context: {
    readonly mentions: readonly MentionRecord[];
  },
): readonly ArchiveFindHit[] {
  const candidatesByQid = new Map<
    string,
    Array<{
      readonly hit: ArchiveFindHit;
      readonly mention: MentionRecord;
    }>
  >();

  for (const { match, mention } of createMentionLexicalHits(
    context.mentions,
    search,
  )) {
    const candidates = candidatesByQid.get(mention.qid) ?? [];

    candidates.push({
      hit: {
        chapter: mention.chapterId,
        field: "title" as const,
        id: `wikg://entity/${mention.qid}`,
        ...createFindMatchFields(match),
        position: {
          chapter: mention.chapterId,
          sentence: mention.sentenceIndex ?? 0,
        },
        snippet: mention.note ?? mention.surface,
        title: mention.surface,
        type: "entity" as const,
      },
      mention,
    });
    candidatesByQid.set(mention.qid, candidates);
  }

  return [...candidatesByQid.values()].map((candidates) => {
    const rankedCandidates = [...candidates].sort((left, right) => {
      const scoreComparison = (right.hit.score ?? 0) - (left.hit.score ?? 0);

      if (scoreComparison !== 0) {
        return scoreComparison;
      }
      if (left.hit.position === undefined) {
        return right.hit.position === undefined ? 0 : 1;
      }
      if (right.hit.position === undefined) {
        return -1;
      }
      return compareArchivePositions(left.hit.position, right.hit.position);
    });
    const [best] = rankedCandidates;

    if (best === undefined) {
      throw new Error("Internal error: entity search candidate is empty.");
    }

    return {
      ...best.hit,
      score: aggregateEvidenceScores(
        rankedCandidates.map((candidate) => candidate.hit.score ?? 0),
      ),
      evidenceMentions: rankedCandidates.map((candidate) => ({
        match: {
          matchCount: candidate.hit.matchCount ?? 0,
          matchedTerms: candidate.hit.matchedTerms ?? [],
          missingTerms: candidate.hit.missingTerms ?? [],
          score: candidate.hit.score ?? 0,
        },
        mention: candidate.mention,
      })),
    };
  });
}

async function findTriples(
  document: ReadonlyDocument,
  search: LexicalQuery,
  context: {
    readonly mentions: readonly MentionRecord[];
  },
): Promise<readonly ArchiveFindHit[]> {
  const mentionsById = new Map(
    context.mentions.map((mention) => [mention.id, mention]),
  );
  const hitsByTriple = new Map<string, ArchiveFindHit[]>();

  for (const chapter of await listChapters(document)) {
    for (const link of await document.mentionLinks.listByChapter(
      chapter.chapterId,
    )) {
      const [source, target] = await Promise.all([
        getMentionForTripleSearch(document, mentionsById, link.sourceMentionId),
        getMentionForTripleSearch(document, mentionsById, link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }

      const text = `${source.surface} ${link.predicate} ${target.surface}`;
      const match = scoreLexicalText(text, search);

      if (match === undefined) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);
      const next = {
        chapter: source.chapterId,
        evidenceLinks: [link],
        field: "content" as const,
        id,
        ...createFindMatchFields(match),
        position: {
          chapter: source.chapterId,
          sentence: source.sentenceIndex ?? 0,
        },
        snippet: link.note ?? text,
        title: text,
        triple: {
          objectLabel: target.surface,
          predicate: link.predicate,
          subjectLabel: source.surface,
        },
        type: "triple" as const,
      };
      const values = hitsByTriple.get(id) ?? [];

      values.push(next);
      hitsByTriple.set(id, values);
    }
  }

  return [...hitsByTriple.values()].map(groupTripleEvidenceHits);
}

async function listAllMentions(
  document: ReadonlyDocument,
): Promise<readonly MentionRecord[]> {
  return await document.mentions.listAll();
}

function groupTripleEvidenceHits(
  evidenceHits: readonly ArchiveFindHit[],
): ArchiveFindHit {
  const rankedHits = [...evidenceHits].sort(compareFindEvidenceHits);
  const [best] = rankedHits;

  if (best === undefined) {
    throw new Error("Internal error: triple search candidate is empty.");
  }

  return {
    ...best,
    evidenceLinks: rankedHits.flatMap((hit) => hit.evidenceLinks ?? []),
    score: aggregateEvidenceScores(rankedHits.map((hit) => hit.score ?? 0)),
  };
}

function listEntityCollection(
  mentions: readonly MentionRecord[],
  documentOrders?: ReadonlyMap<number, number>,
): readonly ArchiveFindHit[] {
  const mentionsByQid = new Map<string, MentionRecord[]>();

  for (const mention of mentions) {
    const values = mentionsByQid.get(mention.qid) ?? [];

    values.push(mention);
    mentionsByQid.set(mention.qid, values);
  }

  return [...mentionsByQid.entries()].map(([qid, qidMentions]) => {
    const [first] = qidMentions.sort(compareMentions);

    if (first === undefined) {
      throw new Error("Internal error: entity collection candidate is empty.");
    }

    return {
      chapter: first.chapterId,
      evidenceMentions: qidMentions.map((mention) =>
        createUnscoredEntityEvidenceMention(mention),
      ),
      field: "title",
      id: `wikg://entity/${qid}`,
      position: {
        chapter: first.chapterId,
        documentOrder: documentOrders?.get(first.chapterId) ?? first.chapterId,
        sentence: first.sentenceIndex ?? 0,
      },
      score: qidMentions.length,
      snippet: `${qidMentions.length} mentions`,
      title: selectEntityLabel(qidMentions),
      type: "entity",
    };
  });
}

function listTextStreamSentenceCollection(
  index: ArchiveTextStreamIndex,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  title: string,
  documentOrder?: number,
): readonly ArchiveFindHit[] {
  return index.sentences.map((sentence) => ({
    chapter: chapterId,
    field: stream,
    id: formatTextStreamRangeUri(
      chapterId,
      stream,
      sentence.globalIndex,
      sentence.globalIndex,
    ),
    position: {
      chapter: chapterId,
      documentOrder: documentOrder ?? chapterId,
      fragment: sentence.fragmentId,
      sentence: sentence.localIndex,
    },
    snippet: createSnippet(sentence.text),
    title,
    type: stream === "source" ? "source" : "summary",
  }));
}

async function listTripleCollection(
  document: ReadonlyDocument,
  chapterFilter?: ReadonlySet<number>,
  documentOrders?: ReadonlyMap<number, number>,
): Promise<readonly ArchiveFindHit[]> {
  const hitsById = new Map<string, ArchiveFindHit>();

  for (const chapter of filterChapters(
    await listChapters(document),
    chapterFilter,
  )) {
    for (const link of await document.mentionLinks.listByChapter(
      chapter.chapterId,
    )) {
      const [source, target] = await Promise.all([
        document.mentions.getById(link.sourceMentionId),
        document.mentions.getById(link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);
      const existing = hitsById.get(id);

      if (existing !== undefined) {
        hitsById.set(id, {
          ...existing,
          evidenceLinks: [...(existing.evidenceLinks ?? []), link],
          score: (existing.evidenceLinks?.length ?? 0) + 1,
        });
        continue;
      }

      hitsById.set(id, {
        chapter: source.chapterId,
        evidenceLinks: [link],
        field: "title",
        id,
        position: {
          chapter: source.chapterId,
          documentOrder:
            documentOrders?.get(source.chapterId) ?? source.chapterId,
          sentence: source.sentenceIndex ?? 0,
        },
        score: 1,
        snippet: `${source.surface} ${link.predicate} ${target.surface}`,
        title: `${source.qid} ${link.predicate} ${target.qid}`,
        triple: {
          objectLabel: target.surface,
          predicate: link.predicate,
          subjectLabel: source.surface,
        },
        type: "triple",
      });
    }
  }

  return [...hitsById.values()];
}

function compareMentions(left: MentionRecord, right: MentionRecord): number {
  return (
    compareNumbers(left.chapterId, right.chapterId) ||
    compareNumbers(left.sentenceIndex ?? 0, right.sentenceIndex ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

async function getMentionForTripleSearch(
  document: ReadonlyDocument,
  cache: Map<string, MentionRecord>,
  mentionId: string,
): Promise<MentionRecord | undefined> {
  const cached = cache.get(mentionId);

  if (cached !== undefined) {
    return cached;
  }

  const mention = await document.mentions.getById(mentionId);

  if (mention !== undefined) {
    cache.set(mentionId, mention);
  }

  return mention;
}

async function hydrateFindHitEvidence(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  options: {
    readonly evidenceLimit?: number;
    readonly order?: ArchiveFindOrder;
    readonly sessionId?: string;
    readonly sourceContext?: number;
  } = {},
): Promise<readonly ArchiveFindHit[]> {
  const evidenceContext = createEvidenceReadContext();

  const hydrated = await Promise.all(
    hits.map(async (rawHit) => {
      const displayHit = await hydrateEntityDisplayHit(document, rawHit);
      const hit = await hydrateTextStreamHitContext(
        document,
        displayHit,
        options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
        evidenceContext,
      );

      if (hit.evidence !== undefined && hit.evidence.sources.length > 0) {
        return hit;
      }
      if (
        hit.evidence !== undefined &&
        hit.type === "entity" &&
        options.sessionId !== undefined
      ) {
        return await hydrateEntitySessionHitEvidence(
          document,
          hit,
          options.sessionId,
          options.evidenceLimit,
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          evidenceContext,
        );
      }
      if (hit.evidenceLinks !== undefined) {
        if (options.evidenceLimit === undefined) {
          const { evidenceLinks: _evidenceLinks, ...publicHit } = hit;

          return publicHit;
        }

        const evidence = await createMentionLinkEvidencePreview(
          document,
          hit.evidenceLinks,
          options.evidenceLimit,
          evidenceContext,
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        );
        const { evidenceLinks: _evidenceLinks, ...publicHit } = hit;

        return {
          ...publicHit,
          evidence,
        };
      }
      if (hit.evidenceMentions === undefined) {
        return hit;
      }
      if (options.evidenceLimit === undefined) {
        const { evidenceMentions: _evidenceMentions, ...publicHit } = hit;

        return publicHit;
      }

      const evidence = await createMentionEvidencePreview(
        document,
        hit.evidenceMentions.map((item) => item.mention),
        options.evidenceLimit,
        evidenceContext,
        options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
        options.order ?? "doc-asc",
      );
      const { evidenceMentions: _evidenceMentions, ...publicHit } = hit;

      return {
        ...publicHit,
        evidence,
      };
    }),
  );

  return await coalesceTextStreamFindHits(document, hydrated, evidenceContext);
}

async function hydrateEntityDisplayHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit> {
  if (hit.type !== "entity") {
    return hit;
  }

  const qid = parseEntityQid(hit.id);

  if (qid === undefined) {
    return hit;
  }
  if (hit.title !== qid && hit.snippet !== qid) {
    return hit;
  }

  const mentions = await document.mentions.listByQid(qid);
  const [first] = mentions.sort(compareMentions);

  if (first === undefined) {
    return hit;
  }

  return {
    ...hit,
    chapter: first.chapterId,
    position: {
      chapter: first.chapterId,
      sentence: first.sentenceIndex ?? 0,
    },
    snippet: hit.snippet === qid ? (first.note ?? first.surface) : hit.snippet,
    title: hit.title === qid ? selectEntityLabel(mentions) : hit.title,
  };
}

async function hydrateTextStreamHitContext(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
  sourceContext: number,
  context: EvidenceReadContext,
): Promise<ArchiveFindHit> {
  if (sourceContext <= 0 || (hit.type !== "source" && hit.type !== "summary")) {
    return hit;
  }
  if (hit.matchCount === undefined && hit.matchedTerms === undefined) {
    return hit;
  }

  const reference = parseTextStreamHitReference(hit.id);

  if (reference === undefined) {
    return hit;
  }

  const range = await readTextStreamRange(
    document,
    reference.chapterId,
    reference.stream,
    reference.startSentenceIndex - sourceContext,
    reference.endSentenceIndex + sourceContext,
    context,
  );

  return {
    ...hit,
    id: range.id,
    snippet: range.text,
  };
}

function parseTextStreamHitReference(
  uri: string,
): Extract<WikiGraphReference, { readonly type: "text-stream" }> | undefined {
  if (!isWikiGraphObjectUri(uri)) {
    return undefined;
  }

  try {
    const reference = parseWikiGraphReference(normalizeWikiGraphObjectUri(uri));

    return reference.type === "text-stream" ? reference : undefined;
  } catch {
    return undefined;
  }
}

async function coalesceTextStreamFindHits(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  context: EvidenceReadContext,
): Promise<readonly ArchiveFindHit[]> {
  const entries: Array<
    | { readonly hit: ArchiveFindHit; readonly type: "hit" }
    | { range: TextStreamHitRange; readonly type: "range" }
  > = [];

  for (const hit of hits) {
    const range = parseSearchTextStreamHitRange(hit);

    if (range === undefined || hit.backlinks !== undefined) {
      entries.push({ hit, type: "hit" });
      continue;
    }

    const overlappingIndexes = entries
      .map((entry, index) =>
        entry.type === "range" &&
        areMergeableTextStreamHitRanges(entry.range, range)
          ? index
          : -1,
      )
      .filter((index) => index >= 0);

    if (overlappingIndexes.length === 0) {
      entries.push({ range, type: "range" });
      continue;
    }

    const firstIndex = overlappingIndexes[0] ?? 0;
    const ranges = overlappingIndexes.flatMap((index) => {
      const entry = entries[index];

      return entry?.type === "range" ? [entry.range] : [];
    });

    entries[firstIndex] = {
      range: await mergeTextStreamHitRangeGroup(
        document,
        [...ranges, range],
        context,
      ),
      type: "range",
    };

    for (const index of overlappingIndexes.slice(1).reverse()) {
      entries.splice(index, 1);
    }
  }

  return entries.map((entry) =>
    entry.type === "range" ? entry.range.hit : entry.hit,
  );
}

function parseSearchTextStreamHitRange(
  hit: ArchiveFindHit,
): TextStreamHitRange | undefined {
  if (hit.type !== "source" && hit.type !== "summary") {
    return undefined;
  }
  if (hit.matchCount === undefined && hit.matchedTerms === undefined) {
    return undefined;
  }

  const reference = parseTextStreamHitReference(hit.id);

  if (reference === undefined) {
    return undefined;
  }

  return {
    chapterId: reference.chapterId,
    endSentenceIndex: reference.endSentenceIndex,
    hit,
    startSentenceIndex: reference.startSentenceIndex,
    stream: reference.stream,
  };
}

function areMergeableTextStreamHitRanges(
  left: TextStreamHitRange,
  right: TextStreamHitRange,
): boolean {
  return (
    left.chapterId === right.chapterId &&
    left.stream === right.stream &&
    right.startSentenceIndex <= left.endSentenceIndex + 1 &&
    left.startSentenceIndex <= right.endSentenceIndex + 1
  );
}

async function mergeTextStreamHitRangeGroup(
  document: ReadonlyDocument,
  ranges: readonly TextStreamHitRange[],
  context: EvidenceReadContext,
): Promise<TextStreamHitRange> {
  const [representative] = ranges;

  if (representative === undefined) {
    throw new Error(
      "Internal error: cannot merge empty text stream hit group.",
    );
  }

  const startSentenceIndex = Math.min(
    ...ranges.map((range) => range.startSentenceIndex),
  );
  const endSentenceIndex = Math.max(
    ...ranges.map((range) => range.endSentenceIndex),
  );
  const text = await readTextStreamRange(
    document,
    representative.chapterId,
    representative.stream,
    startSentenceIndex,
    endSentenceIndex,
    context,
  );
  const hits = ranges.map((range) => range.hit);
  const scores = hits
    .map((hit) => hit.score)
    .filter((score): score is number => score !== undefined);

  return {
    chapterId: representative.chapterId,
    endSentenceIndex,
    hit: {
      ...representative.hit,
      id: text.id,
      matchCount: Math.max(...hits.map((hit) => hit.matchCount ?? 0)),
      matchedTerms: mergeStringLists(
        hits.flatMap((hit) => hit.matchedTerms ?? []),
      ),
      missingTerms: mergeStringLists(
        hits.flatMap((hit) => hit.missingTerms ?? []),
      ),
      ...(scores.length === 0 ? {} : { score: Math.max(...scores) }),
      snippet: text.text,
    },
    startSentenceIndex,
    stream: representative.stream,
  };
}

async function hydrateFindResultBacklinks(
  document: ReadonlyDocument,
  result: ArchiveFindResult,
  options: Pick<ArchiveFindOptions, "backlinks">,
): Promise<ArchiveFindResult> {
  return {
    ...result,
    items: await hydrateFindHitBacklinks(document, result.items, options),
  };
}

async function hydrateFindHitBacklinks(
  document: ReadonlyDocument,
  hits: readonly ArchiveFindHit[],
  options:
    | Pick<ArchiveFindOptions, "backlinks">
    | Pick<ArchiveCollectionOptions, "backlinks">,
): Promise<readonly ArchiveFindHit[]> {
  if (options.backlinks !== true) {
    return hits;
  }

  return await Promise.all(
    hits.map(async (hit) => {
      const reference = parseSourceBacklinkReference(hit.id);

      if (reference === undefined) {
        return hit;
      }

      return {
        ...hit,
        backlinks: await createTextStreamBacklinks(document, reference),
      };
    }),
  );
}

function parseSourceBacklinkReference(
  uri: string,
): Extract<WikiGraphReference, { readonly type: "text-stream" }> | undefined {
  if (!isWikiGraphObjectUri(uri)) {
    return undefined;
  }

  try {
    const reference = parseWikiGraphReference(normalizeWikiGraphObjectUri(uri));

    return reference.type === "text-stream" && reference.stream === "source"
      ? reference
      : undefined;
  } catch {
    return undefined;
  }
}

function createFindEvidenceHydrationOptions(
  options: ArchiveFindOptions,
  sessionId?: string,
): {
  readonly evidenceLimit?: number;
  readonly order?: ArchiveFindOrder;
  readonly sessionId?: string;
  readonly sourceContext?: number;
} {
  return {
    ...(options.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: options.evidenceLimit }),
    order: options.order ?? "doc-asc",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(options.sourceContext === undefined
      ? {}
      : { sourceContext: options.sourceContext }),
  };
}

async function createTextStreamBacklinks(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ArchiveBacklinks> {
  if (reference.stream !== "source") {
    return createEmptyBacklinks();
  }

  const sentenceKeys = await createTextStreamRangeSentenceKeySet(
    document,
    reference,
  );
  const [chunks, mentions, links] = await Promise.all([
    createChunkBacklinkHits(document, sentenceKeys),
    createEntityBacklinkHits(document, sentenceKeys),
    createTripleBacklinkHits(document, reference.chapterId, sentenceKeys),
  ]);

  return {
    chunks: createBacklinkBucket(chunks),
    entities: createBacklinkBucket(mentions),
    triples: createBacklinkBucket(links),
  };
}

function createEmptyBacklinks(): ArchiveBacklinks {
  return {
    chunks: createBacklinkBucket([]),
    entities: createBacklinkBucket([]),
    triples: createBacklinkBucket([]),
  };
}

function createBacklinkBucket(
  hits: readonly ArchiveFindHit[],
): ArchiveBacklinkBucket {
  const sorted = [...hits].sort((left, right) =>
    compareListHits(left, right, "doc-asc"),
  );

  return {
    items: sorted,
    limit: sorted.length,
    nextCursor: null,
  };
}

async function createTextStreamRangeSentenceKeySet(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ReadonlySet<string>> {
  const index = await createTextStreamIndex(
    document,
    reference.chapterId,
    reference.stream,
  );
  const lastSentenceIndex = Math.max(0, index.sentences.length - 1);
  const start = clampInteger(
    reference.startSentenceIndex,
    0,
    lastSentenceIndex,
  );
  const end = clampInteger(
    reference.endSentenceIndex,
    start,
    lastSentenceIndex,
  );
  const keys = new Set<string>();

  for (const sentence of index.sentences.slice(start, end + 1)) {
    keys.add(formatSentenceKey(reference.chapterId, sentence.globalIndex));
  }

  return keys;
}

async function createChunkBacklinkHits(
  document: ReadonlyDocument,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  return (await document.chunks.listAll())
    .filter((chunk) =>
      chunk.sentenceIds.some((sentenceId) =>
        sentenceKeys.has(formatSentenceIdKey(sentenceId)),
      ),
    )
    .map((chunk) => {
      const position = createNodePosition(chunk.sentenceIds);

      return {
        chapter: chunk.sentenceId[0],
        field: "content" as const,
        id: formatNodeId(chunk.id),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(chunk.content),
        title: chunk.label,
        type: "node" as const,
      };
    });
}

async function createEntityBacklinkHits(
  document: ReadonlyDocument,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  return listEntityCollection(
    (await listAllMentions(document)).filter((mention) =>
      sentenceKeys.has(
        formatSentenceKey(mention.chapterId, mention.sentenceIndex ?? 0),
      ),
    ),
  );
}

async function createTripleBacklinkHits(
  document: ReadonlyDocument,
  chapterId: number,
  sentenceKeys: ReadonlySet<string>,
): Promise<readonly ArchiveFindHit[]> {
  const hitsById = new Map<string, ArchiveFindHit>();

  for (const link of await document.mentionLinks.listByChapter(chapterId)) {
    const evidenceSentenceIds = link.evidenceSentenceIds.filter((sentenceId) =>
      sentenceKeys.has(formatSentenceIdKey(sentenceId)),
    );

    if (evidenceSentenceIds.length === 0) {
      continue;
    }

    const [source, target] = await Promise.all([
      document.mentions.getById(link.sourceMentionId),
      document.mentions.getById(link.targetMentionId),
    ]);

    if (source === undefined || target === undefined) {
      continue;
    }

    const id = formatTripleUri(source.qid, link.predicate, target.qid);
    const existing = hitsById.get(id);
    const evidenceLink = { ...link, evidenceSentenceIds };

    if (existing !== undefined) {
      hitsById.set(id, {
        ...existing,
        evidenceLinks: [...(existing.evidenceLinks ?? []), evidenceLink],
        score: (existing.evidenceLinks?.length ?? 0) + 1,
      });
      continue;
    }

    hitsById.set(id, {
      chapter: source.chapterId,
      evidenceLinks: [evidenceLink],
      field: "title",
      id,
      position: createSentencePosition(
        [...evidenceSentenceIds].sort(compareSentenceIds)[0] ?? [
          source.chapterId,
          source.sentenceIndex ?? 0,
        ],
      ),
      score: 1,
      snippet: `${source.surface} ${link.predicate} ${target.surface}`,
      title: `${source.qid} ${link.predicate} ${target.qid}`,
      triple: {
        objectLabel: target.surface,
        predicate: link.predicate,
        subjectLabel: source.surface,
      },
      type: "triple",
    });
  }

  return [...hitsById.values()];
}

function formatSentenceIdKey(sentenceId: SentenceId): string {
  return formatSentenceKey(sentenceId[0], sentenceId[1]);
}

function formatSentenceKey(chapterId: number, sentenceIndex: number): string {
  return `${chapterId}:${sentenceIndex}`;
}

function createUnscoredEntityEvidenceMention(
  mention: MentionRecord,
): EntityEvidenceMention {
  return {
    match: {
      matchCount: 0,
      matchedTerms: [],
      missingTerms: [],
      score: 0,
    },
    mention,
  };
}

async function hydrateEntitySessionHitEvidence(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
  sessionId: string,
  evidenceLimit: number | undefined,
  sourceContext: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
): Promise<ArchiveFindHit> {
  if (evidenceLimit === undefined) {
    const { evidence: _evidence, ...publicHit } = hit;

    return publicHit;
  }

  const qid = parseEntityQid(hit.id);

  if (qid === undefined) {
    return hit;
  }

  const mentionsByQid = await document.mentions.listByQid(qid);
  const mentionsById = new Map(
    mentionsByQid.map((mention) => [mention.id, mention]),
  );
  const allMentions = (
    await readEntitySearchEvidenceMentions(
      sessionId,
      mentionsByQid.map((mention) => mention.id),
      10_000,
    )
  ).flatMap((hit) => {
    const mention = mentionsById.get(hit.mentionId);

    return mention === undefined ? [] : [mention];
  });
  const ranges = await createMentionEvidenceRanges(document, allMentions);
  const mergedRanges = await createExpandedSourceEvidenceRanges(
    document,
    ranges,
    sourceContext,
    context,
  );
  const sources = await Promise.all(
    mergedRanges
      .slice(0, evidenceLimit)
      .map(
        async (range) =>
          await createSourceEvidenceItem(
            document,
            range.chapterId,
            range.startSentenceIndex,
            range.endSentenceIndex,
            context,
          ),
      ),
  );

  return {
    ...hit,
    ...(allMentions[0] === undefined
      ? {}
      : {
          chapter: allMentions[0].chapterId,
          position: {
            chapter: allMentions[0].chapterId,
            sentence: allMentions[0].sentenceIndex ?? 0,
          },
          snippet: allMentions[0].note ?? allMentions[0].surface,
          title: allMentions[0].surface,
        }),
    evidence: {
      nextCursor:
        sources.length < mergedRanges.length
          ? encodeFindCursor(sources.length)
          : null,
      shown: sources.length,
      sources,
      total: mergedRanges.length,
    },
  };
}

function formatTripleUri(
  subjectQid: string,
  predicate: string,
  objectQid: string,
): string {
  return `wikg://triple/${subjectQid}/${encodeURIComponent(predicate)}/${objectQid}`;
}

function formatEntityUri(qid: string): string {
  return `wikg://entity/${qid}`;
}

function isEntityOnlySearch(options: ArchiveFindOptions): boolean {
  return isEntitySearchTypes(options.types ?? null);
}

function isEntitySearchTypes(types: readonly string[] | null): boolean {
  return types !== null && types.length === 1 && types[0] === "entity";
}

function assertSearchCursorTypesMatch(
  requestedTypes: readonly string[] | undefined,
  sessionTypes: readonly string[] | null,
): void {
  if (requestedTypes === undefined) {
    return;
  }
  if (requestedTypes.length !== (sessionTypes?.length ?? 0)) {
    throw new Error("Search cursor does not match the requested result types.");
  }
  const sessionTypeSet = new Set(sessionTypes ?? []);

  if (requestedTypes.some((type) => !sessionTypeSet.has(type))) {
    throw new Error("Search cursor does not match the requested result types.");
  }
}

function createEntitySearchCacheInput(
  hits: readonly ArchiveFindHit[],
  indexResult?: SearchIndexQueryResult,
): {
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
} {
  const evidenceEvents: SearchEvidenceHitEventInput[] = [];
  const evidenceScoresByQid = new Map<string, number[]>();
  const propertyScoresByQid = new Map<string, number[]>();

  for (const hit of indexResult?.objectHits ?? []) {
    if (hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity) {
      continue;
    }

    const scores = propertyScoresByQid.get(hit.ownerId) ?? [];

    scores.push(hit.score);
    propertyScoresByQid.set(hit.ownerId, scores);
  }

  for (const hit of hits) {
    if (hit.type !== "entity" || hit.evidenceMentions === undefined) {
      continue;
    }

    const qid = parseEntityQid(hit.id);

    if (qid === undefined) {
      continue;
    }

    const scores = evidenceScoresByQid.get(qid) ?? [];

    for (const evidenceMention of hit.evidenceMentions) {
      const sentenceIndex = evidenceMention.mention.sentenceIndex;

      if (sentenceIndex === undefined) {
        continue;
      }

      const score = evidenceMention.match.score ?? hit.score ?? 0;

      evidenceEvents.push({
        chapterId: evidenceMention.mention.chapterId,
        evidenceId: evidenceMention.mention.id,
        evidenceKind: SEARCH_EVIDENCE_KIND.mention,
        score,
        sentenceIndex,
      });
      scores.push(score);
    }

    evidenceScoresByQid.set(qid, scores);
  }

  const qids = new Set([
    ...evidenceScoresByQid.keys(),
    ...propertyScoresByQid.keys(),
  ]);

  return {
    entityHits: [...qids].map((qid) => ({
      evidenceTopScores: evidenceScoresByQid.get(qid) ?? [],
      propertyTopScores: propertyScoresByQid.get(qid) ?? [],
      qid,
    })),
    evidenceEvents,
  };
}

async function createSentenceEvidenceSearchCacheInput(
  document: ReadonlyDocument,
  indexResult: SearchIndexQueryResult | undefined,
  options: ArchiveFindOptions,
): Promise<{
  readonly chunkHits: readonly SearchChunkHitInput[];
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
  readonly tripleHits: readonly SearchTripleHitInput[];
}> {
  if (indexResult === undefined || isTextOnlySearch(options)) {
    return {
      chunkHits: [],
      entityHits: [],
      evidenceEvents: [],
      tripleHits: [],
    };
  }

  const sourceHits = indexResult.textHits.filter(
    (hit) => hit.kind === TEXT_SENTENCE_KIND.source,
  );

  if (sourceHits.length === 0) {
    return {
      chunkHits: [],
      entityHits: [],
      evidenceEvents: [],
      tripleHits: [],
    };
  }

  const sourceHitScores = new Map<string, number>();
  const chapterIds = new Set<number>();

  for (const hit of sourceHits) {
    sourceHitScores.set(
      createSentenceHitKey(hit.chapterId, hit.sentenceIndex),
      hit.score,
    );
    chapterIds.add(hit.chapterId);
  }

  const evidenceEvents: SearchEvidenceHitEventInput[] = [];
  const entityEvidenceScoresByQid = new Map<string, number[]>();
  const chunkEvidenceScoresById = new Map<number, number[]>();
  const tripleEvidenceScoresByKey = new Map<
    string,
    {
      readonly objectQid: string;
      readonly predicate: string;
      readonly scores: number[];
      readonly subjectQid: string;
    }
  >();

  for (const chapterId of chapterIds) {
    for (const mention of await document.mentions.listByChapter(chapterId)) {
      if (mention.sentenceIndex === undefined) {
        continue;
      }

      const score = sourceHitScores.get(
        createSentenceHitKey(chapterId, mention.sentenceIndex),
      );

      if (score === undefined) {
        continue;
      }

      evidenceEvents.push({
        chapterId,
        evidenceId: mention.id,
        evidenceKind: SEARCH_EVIDENCE_KIND.mention,
        score,
        sentenceIndex: mention.sentenceIndex,
      });
      const scores = entityEvidenceScoresByQid.get(mention.qid) ?? [];

      scores.push(score);
      entityEvidenceScoresByQid.set(mention.qid, scores);
    }

    for (const chunk of await document.chunks.listBySerial(chapterId)) {
      for (const [, sentenceIndex] of chunk.sentenceIds) {
        const score = sourceHitScores.get(
          createSentenceHitKey(chapterId, sentenceIndex),
        );

        if (score === undefined) {
          continue;
        }

        evidenceEvents.push({
          chapterId,
          evidenceId: String(chunk.id),
          evidenceKind: SEARCH_EVIDENCE_KIND.chunk,
          score,
          sentenceIndex,
        });
        const scores = chunkEvidenceScoresById.get(chunk.id) ?? [];

        scores.push(score);
        chunkEvidenceScoresById.set(chunk.id, scores);
      }
    }

    const mentionCache = new Map<string, MentionRecord>();

    for (const link of await document.mentionLinks.listByChapter(chapterId)) {
      const [source, target] = await Promise.all([
        getMentionForTripleSearch(document, mentionCache, link.sourceMentionId),
        getMentionForTripleSearch(document, mentionCache, link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }

      for (const [
        evidenceChapterId,
        sentenceIndex,
      ] of link.evidenceSentenceIds) {
        const score = sourceHitScores.get(
          createSentenceHitKey(evidenceChapterId, sentenceIndex),
        );

        if (score === undefined) {
          continue;
        }

        evidenceEvents.push({
          chapterId: evidenceChapterId,
          evidenceId: link.id,
          evidenceKind: SEARCH_EVIDENCE_KIND.mentionLink,
          score,
          sentenceIndex,
        });

        const key = formatTripleUri(source.qid, link.predicate, target.qid);
        const current = tripleEvidenceScoresByKey.get(key) ?? {
          objectQid: target.qid,
          predicate: link.predicate,
          scores: [],
          subjectQid: source.qid,
        };

        current.scores.push(score);
        tripleEvidenceScoresByKey.set(key, current);
      }
    }
  }

  return {
    chunkHits: [...chunkEvidenceScoresById.entries()].map(
      ([chunkId, scores]) => ({
        chunkId,
        evidenceTopScores: scores,
      }),
    ),
    entityHits: [...entityEvidenceScoresByQid.entries()].map(
      ([qid, scores]) => ({
        evidenceTopScores: scores,
        qid,
      }),
    ),
    evidenceEvents,
    tripleHits: [...tripleEvidenceScoresByKey.values()].map((hit) => ({
      evidenceTopScores: hit.scores,
      objectQid: hit.objectQid,
      predicate: hit.predicate,
      subjectQid: hit.subjectQid,
    })),
  };
}

function createSentenceHitKey(
  chapterId: number,
  sentenceIndex: number,
): string {
  return `${chapterId}:${sentenceIndex}`;
}

function parseEntityQid(id: string): string | undefined {
  const normalized = normalizeWikiGraphObjectUri(id);
  const prefix = `${WIKI_GRAPH_URI_PREFIX}entity/`;

  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : undefined;
}

function filterLexicalHitsByMatch(
  hits: readonly ArchiveFindHit[],
  search: LexicalQuery,
  match: ArchiveFindMatch,
): readonly ArchiveFindHit[] {
  if (match === "any") {
    return hits;
  }

  const requiredTerms = [...search.phrases];

  if (requiredTerms.length === 0) {
    return hits;
  }

  return hits.filter((hit) =>
    requiredTerms.every((term) => hit.matchedTerms?.includes(term) === true),
  );
}

async function findChapters(
  document: ReadonlyDocument,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const chapter of await listChapters(document)) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;
    const titleMatch = matchText(title, search);

    if (titleMatch !== undefined) {
      hits.push({
        chapter: chapter.chapterId,
        field: "title",
        id: formatChapterTitleId(chapter.chapterId),
        ...createFindMatchFields(titleMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: title,
        title,
        type: "chapter-title",
      });
    }

    hits.push(
      ...(await findTextStreamSentences(
        document,
        chapter.chapterId,
        "summary",
        title,
        search,
      )),
    );

    hits.push(
      ...(await findTextStreamSentences(
        document,
        chapter.chapterId,
        "source",
        title,
        search,
      )),
    );
  }

  return hits;
}

async function findTextStreamSentences(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  title: string,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const index = await createTextStreamIndex(document, chapterId, stream);

  return index.sentences.flatMap((sentence) => {
    const match = matchText(sentence.text, search);

    if (match === undefined) {
      return [];
    }

    return [
      {
        chapter: chapterId,
        field: stream,
        id: formatTextStreamRangeUri(
          chapterId,
          stream,
          sentence.globalIndex,
          sentence.globalIndex,
        ),
        ...createFindMatchFields(match),
        position: {
          chapter: chapterId,
          fragment: sentence.fragmentId,
          sentence: sentence.localIndex,
        },
        snippet: createSnippet(sentence.text, getSnippetNeedle(match)),
        title,
        type: stream === "source" ? ("source" as const) : ("summary" as const),
      },
    ];
  });
}

async function readSourceFragment(
  document: ReadonlyDocument,
  serialId: number,
  fragmentId: number,
): Promise<ArchiveSourceFragment> {
  const fragment = await document
    .getSerialFragments(serialId)
    .getFragment(fragmentId);
  const text = fragment.sentences.map((sentence) => sentence.text).join("\n");

  return {
    fragmentId,
    id: formatFragmentId(serialId, fragmentId),
    preview: createSnippet(text),
    sentenceCount: fragment.sentences.length,
    text,
    wordsCount: fragment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    ),
  };
}

async function createTextStreamRangeFragment(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "text-stream" }>,
): Promise<ArchiveSourceFragment> {
  const range = await readTextStreamRange(
    document,
    reference.chapterId,
    reference.stream,
    reference.startSentenceIndex,
    reference.endSentenceIndex,
  );

  return {
    fragmentId: range.startSentenceIndex,
    id: range.id,
    preview: createSnippet(range.text),
    sentenceCount: range.endSentenceIndex - range.startSentenceIndex + 1,
    text: range.text,
    wordsCount: countWords(range.text),
  };
}

async function readTextStreamRange(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  startSentenceIndex: number,
  endSentenceIndex: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
): Promise<{
  readonly endSentenceIndex: number;
  readonly id: string;
  readonly startSentenceIndex: number;
  readonly text: string;
}> {
  const index = await getTextStreamIndex(document, chapterId, stream, context);
  if (index.sentences.length === 0) {
    throw new Error(
      `Chapter ${formatChapterId(chapterId)} has no ${stream} text.`,
    );
  }

  const lastSentenceIndex = index.sentences.length - 1;
  if (startSentenceIndex > lastSentenceIndex) {
    throw new Error(
      `${stream} range ${formatTextStreamRangeUri(chapterId, stream, startSentenceIndex, endSentenceIndex)} is out of bounds. Last sentence number is ${lastSentenceIndex + 1}.`,
    );
  }

  const start = clampInteger(startSentenceIndex, 0, lastSentenceIndex);
  const end = clampInteger(endSentenceIndex, start, lastSentenceIndex);
  const sentences = index.sentences.slice(start, end + 1);
  const text =
    normalizeRenderedTextStreamRange(
      await readTextStreamRawRange(document, chapterId, stream, start, end),
    ) ?? joinTextStreamSentences(sentences);

  return {
    endSentenceIndex: end,
    id: formatTextStreamRangeUri(chapterId, stream, start, end),
    startSentenceIndex: start,
    text,
  };
}

async function readTextStreamText(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): Promise<string> {
  const serial = getTextStreamSerial(document, chapterId, stream);
  const text = await serial.readText?.();

  if (text !== undefined) {
    return text;
  }

  const index = await createTextStreamIndex(document, chapterId, stream);

  return joinTextStreamSentences(index.sentences);
}

async function readTextStreamRawRange(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  startSentenceIndex: number,
  endSentenceIndex: number,
): Promise<string | undefined> {
  const serial = getTextStreamSerial(document, chapterId, stream);

  return await serial.readTextInRange?.(startSentenceIndex, endSentenceIndex);
}

function getTextStreamSerial(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): ReadonlySerialTextStream {
  return stream === "summary"
    ? document.getSummaryFragments(chapterId)
    : document.getSerialFragments(chapterId);
}

function joinTextStreamSentences(
  sentences: readonly Pick<ArchiveTextStreamSentence, "text">[],
): string {
  return sentences.map((sentence) => sentence.text).join("");
}

function normalizeRenderedTextStreamRange(
  text: string | undefined,
): string | undefined {
  return text
    ?.replace(/^(?:[^\S\r\n]*(?:\r\n|\n|\r))+/u, "")
    .replace(/(?:(?:\r\n|\n|\r)[^\S\r\n]*)+$/u, "");
}

async function getTextStreamIndex(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
  context: EvidenceReadContext = createEvidenceReadContext(),
): Promise<ArchiveTextStreamIndex> {
  const key = `${chapterId}:${stream}`;
  let index = context.streamIndexes.get(key);

  if (index === undefined) {
    index = createTextStreamIndex(document, chapterId, stream);
    context.streamIndexes.set(key, index);
  }

  return await index;
}

async function createTextStreamIndex(
  document: ReadonlyDocument,
  chapterId: number,
  stream: ArchiveTextStreamKind,
): Promise<ArchiveTextStreamIndex> {
  if (stream === "summary") {
    const fragments = document.getSummaryFragments(chapterId);
    const sentences: ArchiveTextStreamSentence[] = [];

    for (const fragmentId of await fragments.listFragmentIds()) {
      const fragment = await fragments.getFragment(fragmentId);

      for (let index = 0; index < fragment.sentences.length; index += 1) {
        const sentence = fragment.sentences[index];

        if (sentence === undefined) {
          continue;
        }

        sentences.push({
          fragmentId,
          globalIndex: sentences.length,
          localIndex: index,
          text: sentence.text,
          wordsCount: sentence.wordsCount,
        });
      }
    }

    return { sentences };
  }

  const fragments = document.getSerialFragments(chapterId);
  const sentences: ArchiveTextStreamSentence[] = [];

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (let index = 0; index < fragment.sentences.length; index += 1) {
      const sentence = fragment.sentences[index];

      if (sentence === undefined) {
        continue;
      }

      sentences.push({
        fragmentId,
        globalIndex: sentences.length,
        localIndex: index,
        text: sentence.text,
        wordsCount: sentence.wordsCount,
      });
    }
  }

  return { sentences };
}

function selectEntityLabel(mentions: readonly MentionRecord[]): string {
  return selectEntityLabels(mentions)[0] ?? mentions[0]?.qid ?? "[entity]";
}

function selectEntityLabels(
  mentions: readonly MentionRecord[],
): readonly string[] {
  const counts = new Map<string, number>();

  for (const mention of mentions) {
    counts.set(mention.surface, (counts.get(mention.surface) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => {
      const countComparison = right[1] - left[1];

      return countComparison === 0
        ? left[0].localeCompare(right[0])
        : countComparison;
    })
    .map(([label]) => label);
}

async function createTriplePageLabel(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "triple" }>,
): Promise<string> {
  const [subjectMentions, objectMentions] = await Promise.all([
    document.mentions.listByQid(reference.subjectQid),
    document.mentions.listByQid(reference.objectQid),
  ]);
  const scopedSubjectMentions = filterMentionsByChapter(
    subjectMentions,
    reference.chapterId,
  );
  const scopedObjectMentions = filterMentionsByChapter(
    objectMentions,
    reference.chapterId,
  );
  const subjectLabel =
    scopedSubjectMentions.length === 0
      ? reference.subjectQid
      : selectEntityLabel(scopedSubjectMentions);
  const objectLabel =
    scopedObjectMentions.length === 0
      ? reference.objectQid
      : selectEntityLabel(scopedObjectMentions);

  return `${subjectLabel}(${reference.subjectQid}) ${reference.predicate} ${objectLabel}(${reference.objectQid})`;
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

async function listFragmentNodes(
  document: ReadonlyDocument,
  chapterId: number,
  fragmentId: number,
): Promise<readonly ArchiveNodeLabel[]> {
  return (
    await document.chunks.listBySentenceStartIndexes(chapterId, [fragmentId])
  )
    .map(createPositionedNodeLabel)
    .sort(comparePositionedNodeLabels)
    .map(({ label }) => label);
}

function createNodeLabel(node: ChunkRecord): ArchiveNodeLabel {
  return {
    id: formatNodeId(node.id),
    title: node.label,
  };
}

function createPositionedNodeLabel(node: ChunkRecord): PositionedNodeLabel {
  return {
    label: createNodeLabel(node),
    position: createNodePosition(node.sentenceIds),
  };
}

function comparePositionedNodeLabels(
  left: PositionedNodeLabel,
  right: PositionedNodeLabel,
): number {
  if (left.position !== undefined && right.position !== undefined) {
    return compareArchivePositions(left.position, right.position);
  }

  if (left.position !== undefined) {
    return -1;
  }

  if (right.position !== undefined) {
    return 1;
  }

  return left.label.id.localeCompare(right.label.id);
}

function findMeta(
  meta: BookMeta | undefined,
  search: ArchiveTextSearch,
): readonly ArchiveFindHit[] {
  if (meta === undefined) {
    return [];
  }

  const fields = [
    meta.title,
    ...meta.authors,
    meta.description,
    meta.publisher,
  ].filter(isDefined);
  const content = fields.join("\n");
  const contentMatch = matchText(content, search);

  if (contentMatch === undefined) {
    return [];
  }

  return [
    {
      field: "metadata",
      id: ARCHIVE_ROOT_ID,
      ...createFindMatchFields(contentMatch),
      snippet: createSnippet(content, getSnippetNeedle(contentMatch)),
      title: meta.title ?? "Archive metadata",
      type: "meta",
    },
  ];
}

async function findNodes(
  document: ReadonlyDocument,
  search: ArchiveTextSearch,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const node of await document.chunks.listAll()) {
    const position = createNodePosition(node.sentenceIds);
    const labelMatch = matchText(node.label, search);

    if (labelMatch !== undefined) {
      hits.push({
        chapter: node.sentenceId[0],
        field: "title",
        id: formatNodeId(node.id),
        ...createFindMatchFields(labelMatch),
        ...(position === undefined ? {} : { position }),
        snippet: node.label,
        title: node.label,
        type: "node",
      });
    }
    const contentMatch = matchText(node.content, search);

    if (contentMatch !== undefined) {
      hits.push({
        chapter: node.sentenceId[0],
        field: "content",
        id: formatNodeId(node.id),
        ...createFindMatchFields(contentMatch),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(node.content, getSnippetNeedle(contentMatch)),
        title: node.label,
        type: "node",
      });
    }
  }

  return hits;
}

async function requireChapter(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterEntry> {
  const chapter = (await listChapters(document)).find(
    (entry) => entry.chapterId === chapterId,
  );

  if (chapter === undefined) {
    throw new Error(`Chapter ${formatChapterId(chapterId)} does not exist.`);
  }

  return chapter;
}

async function createChapterState(
  document: ReadonlyDocument,
  chapter: ChapterEntry,
): Promise<ChapterState> {
  const serial = await document.serials.getById(chapter.chapterId);

  return {
    source: chapter.stage === "planned" ? "missing" : "ready",
    "reading-graph":
      chapter.stage === "graphed" || chapter.stage === "summarized"
        ? "ready"
        : "missing",
    "reading-summary": chapter.stage === "summarized" ? "ready" : "missing",
    "knowledge-graph":
      serial?.knowledgeGraphReady === true ? "ready" : "missing",
  };
}

function formatChapterStateSummary(state: ChapterState): string {
  return [
    `source:${state.source}`,
    `reading-graph:${state["reading-graph"]}`,
    `reading-summary:${state["reading-summary"]}`,
    `knowledge-graph:${state["knowledge-graph"]}`,
  ].join(" ");
}

async function requireNode(
  document: ReadonlyDocument,
  nodeId: number,
): Promise<{
  readonly chapterId: number;
  readonly node: GraphNode;
}> {
  const chunk = await document.chunks.getById(nodeId);

  if (chunk === undefined) {
    throw new Error(`Node ${formatNodeId(nodeId)} does not exist.`);
  }

  const chapterId = chunk.sentenceId[0];

  return {
    chapterId,
    node: await getGraphNode(document, chapterId, nodeId),
  };
}

async function readNodeSourceFragments(
  document: ReadonlyDocument,
  node: GraphNode,
): Promise<readonly ArchiveNodeSourceFragment[]> {
  const fragmentIds = await collectNodeSourceFragmentIds(document, node);

  return await Promise.all(
    fragmentIds.map(async ([chapterId, fragmentId]) => {
      const fragment = await readSourceFragment(
        document,
        chapterId,
        fragmentId,
      );
      const index = await createTextStreamIndex(document, chapterId, "source");
      const fragmentSentences = index.sentences.filter(
        (sentence) => sentence.fragmentId === fragmentId,
      );
      const firstSentence = fragmentSentences[0];
      const lastSentence = fragmentSentences[fragmentSentences.length - 1];
      const text = truncateSourceExcerpt(fragment.text);

      return {
        id:
          firstSentence === undefined || lastSentence === undefined
            ? fragment.id
            : formatTextStreamRangeUri(
                chapterId,
                "source",
                firstSentence.globalIndex,
                lastSentence.globalIndex,
              ),
        text,
        truncated: text.length < fragment.text.length,
      };
    }),
  );
}

async function collectNodeSourceFragmentIds(
  document: ReadonlyDocument,
  node: Pick<GraphNode, "sentenceIds">,
): Promise<readonly (readonly [number, number])[]> {
  const seen = new Set<string>();
  const fragmentIds: (readonly [number, number])[] = [];
  const indexes = new Map<number, Promise<ArchiveTextStreamIndex>>();

  for (const [chapterId, sentenceIndex] of node.sentenceIds) {
    let index = indexes.get(chapterId);

    if (index === undefined) {
      index = createTextStreamIndex(document, chapterId, "source");
      indexes.set(chapterId, index);
    }

    const sentence = (await index).sentences[sentenceIndex];

    if (sentence === undefined) {
      continue;
    }

    const fragmentId = sentence.fragmentId;
    const key = `${chapterId}:${fragmentId}`;

    if (!seen.has(key)) {
      seen.add(key);
      fragmentIds.push([chapterId, fragmentId]);
    }
  }

  return fragmentIds;
}

function truncateSourceExcerpt(text: string): string {
  return text.length <= 1200 ? text : `${text.slice(0, 1200)}...`;
}

function createNodeEvidenceRanges(node: Pick<GraphNode, "sentenceIds">): Array<{
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  const ranges = new Map<string, [number, number]>();

  for (const [chapterId, sentenceIndex] of node.sentenceIds) {
    const key = `${chapterId}`;
    const current = ranges.get(key);

    if (current === undefined) {
      ranges.set(key, [sentenceIndex, sentenceIndex]);
    } else {
      ranges.set(key, [
        Math.min(current[0], sentenceIndex),
        Math.max(current[1], sentenceIndex),
      ]);
    }
  }

  return [...ranges.entries()].map(([key, [start, end]]) => {
    const chapterId = Number(key);
    return {
      chapterId,
      endSentenceIndex: end,
      startSentenceIndex: start,
    };
  });
}

async function createMentionEvidencePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    await createMentionEvidenceRanges(document, mentions),
    limit,
    context,
    sourceContext,
    order,
  );
}

async function createMentionEvidenceRanges(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
): Promise<
  Array<{
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly startSentenceIndex: number;
  }>
> {
  return await Promise.all(
    mentions.map(async (mention) => {
      const startSentenceIndex =
        mention.sentenceIndex ??
        (await findSentenceIndexAtOffset(
          document,
          mention.chapterId,
          mention.rangeStart,
        ));
      const endSentenceIndex =
        mention.sentenceIndex ??
        (await findSentenceIndexAtOffset(
          document,
          mention.chapterId,
          Math.max(0, mention.rangeEnd - 1),
        ));

      return {
        chapterId: mention.chapterId,
        endSentenceIndex,
        startSentenceIndex,
      };
    }),
  );
}

async function createMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    createMentionLinkEvidenceRanges(document, links),
    limit,
    context,
    sourceContext,
    order,
  );
}

function createMentionLinkEvidenceRanges(
  _document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
): Array<{
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  return links.flatMap((link) =>
    link.evidenceSentenceIds.map(([chapterId, sentenceIndex]) => ({
      chapterId,
      endSentenceIndex: sentenceIndex,
      startSentenceIndex: sentenceIndex,
    })),
  );
}

function filterMentionsByChapter(
  mentions: readonly MentionRecord[],
  chapterId: number | undefined,
): readonly MentionRecord[] {
  return chapterId === undefined
    ? mentions
    : mentions.filter((mention) => mention.chapterId === chapterId);
}

function filterMentionsByChapterSet(
  mentions: readonly MentionRecord[],
  chapterFilter: ReadonlySet<number> | undefined,
): readonly MentionRecord[] {
  return chapterFilter === undefined
    ? mentions
    : mentions.filter((mention) => chapterFilter.has(mention.chapterId));
}

async function filterMentionLinksByChapter(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  chapterId: number | undefined,
): Promise<readonly MentionLinkRecord[]> {
  if (chapterId === undefined) {
    return links;
  }

  const filtered: MentionLinkRecord[] = [];

  for (const link of links) {
    const source = await document.mentions.getById(link.sourceMentionId);

    if (source?.chapterId === chapterId) {
      filtered.push(link);
    }
  }

  return filtered;
}

async function createSourceEvidencePage(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: ArchiveEvidenceOptions,
): Promise<ArchiveEvidence> {
  const context = createEvidenceReadContext();
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const start = decodeFindCursor(options.cursor);
  const evidenceRanges = await filterAndSortSourceEvidenceRangesByFtsQuery(
    document,
    ranges,
    options.query,
    options.order ?? "doc-asc",
  );
  const displayRanges = await createExpandedSourceEvidenceRanges(
    document,
    evidenceRanges,
    options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
    context,
  );
  const pageRanges = displayRanges.slice(start, start + limit);
  const nextOffset = start + pageRanges.length;
  const items = await Promise.all(
    pageRanges.map(
      async (range) =>
        await createSourceEvidenceItem(
          document,
          range.chapterId,
          range.startSentenceIndex,
          range.endSentenceIndex,
          context,
          range.score,
        ),
    ),
  );

  return {
    items,
    limit,
    nextCursor:
      nextOffset < displayRanges.length ? encodeFindCursor(nextOffset) : null,
  };
}

async function filterAndSortSourceEvidenceRangesByFtsQuery(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  queryText: string | undefined,
  order: ArchiveFindOrder,
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  if (queryText === undefined) {
    return mergeSourceEvidenceRanges(ranges).sort((left, right) =>
      compareSourceEvidenceRanges(left, right, documentOrders, order),
    );
  }

  const indexResult = await queryRequiredSearchIndex(document, queryText, {
    chapters: [...new Set(ranges.map((range) => range.chapterId))],
    types: ["source"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const matchedRanges = new Map<string, SourceEvidenceRange>();
  const rangesByChapterId = new Map<number, SourceEvidenceRange[]>();

  for (const range of ranges) {
    const chapterRanges = rangesByChapterId.get(range.chapterId) ?? [];

    chapterRanges.push(range);
    rangesByChapterId.set(range.chapterId, chapterRanges);
  }

  for (const hit of indexResult.textHits) {
    if (hit.kind !== TEXT_SENTENCE_KIND.source) {
      continue;
    }

    for (const range of rangesByChapterId.get(hit.chapterId) ?? []) {
      if (
        hit.sentenceIndex < range.startSentenceIndex ||
        hit.sentenceIndex > range.endSentenceIndex
      ) {
        continue;
      }

      const key = formatSourceEvidenceRangeKey(range);
      const current = matchedRanges.get(key);

      matchedRanges.set(key, {
        ...range,
        score: Math.max(current?.score ?? 0, hit.score),
      });
    }
  }

  return [...matchedRanges.values()].sort((left, right) => {
    const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

    if (scoreComparison !== 0) {
      return scoreComparison;
    }

    return compareSourceEvidenceRanges(left, right, documentOrders, "doc-asc");
  });
}

function formatSourceEvidenceRangeKey(range: SourceEvidenceRange): string {
  return `${range.chapterId}:${range.startSentenceIndex}:${range.endSentenceIndex}`;
}

function compareSourceEvidenceRanges(
  left: SourceEvidenceRange,
  right: SourceEvidenceRange,
  documentOrders: ReadonlyMap<number, number>,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;

  return (
    (compareNumbers(
      documentOrders.get(left.chapterId) ?? left.chapterId,
      documentOrders.get(right.chapterId) ?? right.chapterId,
    ) ||
      compareNumbers(left.chapterId, right.chapterId) ||
      compareNumbers(left.startSentenceIndex, right.startSentenceIndex) ||
      compareNumbers(left.endSentenceIndex, right.endSentenceIndex)) * direction
  );
}

async function createSourceEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
): Promise<ArchiveFindEvidencePreview> {
  const documentOrders = await document.serials.listDocumentOrders();
  const mergedRanges = mergeSourceEvidenceRanges(ranges).sort((left, right) =>
    compareSourceEvidenceRanges(left, right, documentOrders, order),
  );
  const displayRanges = await createExpandedSourceEvidenceRanges(
    document,
    mergedRanges.slice(0, limit),
    sourceContext,
    context,
  );
  const sources = await Promise.all(
    displayRanges.map(
      async (range) =>
        await createSourceEvidenceItem(
          document,
          range.chapterId,
          range.startSentenceIndex,
          range.endSentenceIndex,
          context,
        ),
    ),
  );

  return {
    nextCursor:
      Math.min(limit, mergedRanges.length) < mergedRanges.length
        ? encodeFindCursor(Math.min(limit, mergedRanges.length))
        : null,
    shown: sources.length,
    sources,
    total: mergedRanges.length,
  };
}

function mergeSourceEvidenceRanges(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange[] {
  const rangesBySource = new Map<
    string,
    Array<{
      readonly end: number;
      readonly score?: number;
      readonly start: number;
    }>
  >();

  for (const range of ranges) {
    const key = `${range.chapterId}`;
    const sourceRanges = rangesBySource.get(key) ?? [];

    sourceRanges.push({
      end: range.endSentenceIndex,
      ...(range.score === undefined ? {} : { score: range.score }),
      start: range.startSentenceIndex,
    });
    rangesBySource.set(key, sourceRanges);
  }

  return [...rangesBySource.entries()].flatMap(([key, ranges]) => {
    const chapterId = Number(key);

    return mergeEvidenceRanges(ranges).map(
      ({ end, score, start }) =>
        ({
          chapterId,
          endSentenceIndex: end,
          ...(score === undefined ? {} : { score }),
          startSentenceIndex: start,
        }) as const,
    );
  });
}

function mergeSourceEvidenceRangesInInputOrder(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange[] {
  const merged: SourceEvidenceRange[] = [];

  for (const range of ranges) {
    const overlappingIndexes = merged
      .map((existing, index) =>
        areMergeableSourceEvidenceRanges(existing, range) ? index : -1,
      )
      .filter((index) => index >= 0);

    if (overlappingIndexes.length === 0) {
      merged.push(range);
      continue;
    }

    const firstIndex = overlappingIndexes[0] ?? 0;
    const overlapping = overlappingIndexes.flatMap((index) => {
      const existing = merged[index];

      return existing === undefined ? [] : [existing];
    });
    const mergedRange = mergeSourceEvidenceRangeGroup([...overlapping, range]);

    merged[firstIndex] = mergedRange;
    for (const index of overlappingIndexes.slice(1).reverse()) {
      merged.splice(index, 1);
    }
  }

  return merged;
}

function areMergeableSourceEvidenceRanges(
  left: SourceEvidenceRange,
  right: SourceEvidenceRange,
): boolean {
  return (
    left.chapterId === right.chapterId &&
    right.startSentenceIndex <= left.endSentenceIndex + 1 &&
    left.startSentenceIndex <= right.endSentenceIndex + 1
  );
}

function mergeSourceEvidenceRangeGroup(
  ranges: readonly SourceEvidenceRange[],
): SourceEvidenceRange {
  const [first] = ranges;

  if (first === undefined) {
    throw new Error("Internal error: cannot merge empty evidence range group.");
  }

  const scores = ranges
    .map((range) => range.score)
    .filter((score): score is number => score !== undefined);

  return {
    chapterId: first.chapterId,
    endSentenceIndex: Math.max(
      ...ranges.map((range) => range.endSentenceIndex),
    ),
    ...(scores.length === 0 ? {} : { score: Math.max(...scores) }),
    startSentenceIndex: Math.min(
      ...ranges.map((range) => range.startSentenceIndex),
    ),
  };
}

async function createExpandedSourceEvidenceRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  sourceContext: number,
  context: EvidenceReadContext,
): Promise<SourceEvidenceRange[]> {
  const expanded = await Promise.all(
    ranges.map(async (range) => {
      if (sourceContext <= 0) {
        return range;
      }

      const sourceIndex = await getTextStreamIndex(
        document,
        range.chapterId,
        "source",
        context,
      );
      const lastSentenceIndex = Math.max(0, sourceIndex.sentences.length - 1);

      return {
        ...range,
        endSentenceIndex: clampInteger(
          range.endSentenceIndex + sourceContext,
          range.startSentenceIndex,
          lastSentenceIndex,
        ),
        startSentenceIndex: clampInteger(
          range.startSentenceIndex - sourceContext,
          0,
          lastSentenceIndex,
        ),
      };
    }),
  );

  return mergeSourceEvidenceRangesInInputOrder(expanded);
}

async function createSourceEvidenceItem(
  document: ReadonlyDocument,
  chapterId: number,
  startSentenceIndex: number,
  endSentenceIndex: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  score?: number,
): Promise<ArchiveEvidenceItem> {
  const chapter = await getEvidenceChapter(document, chapterId, context);
  const range = await readTextStreamRange(
    document,
    chapterId,
    "source",
    startSentenceIndex,
    endSentenceIndex,
    context,
  );

  return {
    chapterId,
    endSentenceIndex: range.endSentenceIndex,
    fragmentId: range.startSentenceIndex,
    id: formatTextStreamRangeUri(
      chapterId,
      "source",
      range.startSentenceIndex,
      range.endSentenceIndex,
    ),
    ...(score === undefined ? {} : { score }),
    source: range.text,
    startSentenceIndex: range.startSentenceIndex,
    title: chapter.title ?? `[chapter ${chapterId}]`,
    type: "source",
  };
}

function createEvidenceReadContext(): EvidenceReadContext {
  return {
    chapters: new Map(),
    streamIndexes: new Map(),
  };
}

async function getEvidenceChapter(
  document: ReadonlyDocument,
  chapterId: number,
  context: EvidenceReadContext,
): Promise<ChapterEntry> {
  let chapter = context.chapters.get(chapterId);

  if (chapter === undefined) {
    chapter = requireChapter(document, chapterId);
    context.chapters.set(chapterId, chapter);
  }

  return await chapter;
}

async function findSentenceIndexAtOffset(
  document: ReadonlyDocument,
  chapterId: number,
  offset: number,
): Promise<number> {
  const serial = document.getSerialFragments(chapterId);
  const sentences =
    serial.listSentences === undefined ? [] : await serial.listSentences();

  if (sentences.length === 0) {
    return 0;
  }
  let cursor = 0;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];

    if (sentence === undefined) {
      continue;
    }

    const nextCursor = cursor + sentence.text.length;

    if (offset <= nextCursor) {
      return index;
    }

    cursor = nextCursor + 1;
  }

  return Math.max(0, sentences.length - 1);
}

function mergeEvidenceRanges(
  ranges: readonly {
    readonly end: number;
    readonly score?: number;
    readonly start: number;
  }[],
): readonly {
  readonly end: number;
  readonly score?: number;
  readonly start: number;
}[] {
  const sortedRanges = [...ranges]
    .map((range) => ({
      ...(range.score === undefined ? {} : { score: range.score }),
      end: Math.max(range.start, range.end),
      start: Math.min(range.start, range.end),
    }))
    .sort((left, right) =>
      left.start === right.start
        ? left.end - right.end
        : left.start - right.start,
    );
  const mergedRanges: Array<{
    end: number;
    score?: number;
    start: number;
  }> = [];

  for (const { end, score, start } of sortedRanges) {
    const last = mergedRanges.at(-1);

    if (last === undefined || start > last.end + 1) {
      mergedRanges.push({
        end,
        ...(score === undefined ? {} : { score }),
        start,
      });
    } else {
      last.end = Math.max(last.end, end);
      if (score !== undefined) {
        last.score = Math.max(last.score ?? score, score);
      }
    }
  }

  return mergedRanges;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
