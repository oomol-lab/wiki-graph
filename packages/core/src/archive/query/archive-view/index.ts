import type {
  ChunkRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
  SentenceId,
} from "../../../document/index.js";
import type { BookMeta } from "../../../source/index.js";
import { WikipageResolver } from "../../../wikipage/index.js";
import type { QidResolution, WikipageSitelink } from "../../../wikipage/index.js";

import {
  getGraphNode,
  listGraphNeighbors,
  type GraphNeighbor,
  type GraphNode,
} from "../../../facade/graph.js";
import { listChapters, type ChapterEntry } from "../../../facade/chapter.js";
import {
  createMentionLexicalHits,
  scoreLexicalText,
  type LexicalQuery,
} from "../lexical-search.js";
import {
  readEntitySearchEvidenceMentions,
  SEARCH_EVIDENCE_KIND,
  type SearchChunkHitInput,
  type SearchEntityHitInput,
  type SearchEvidenceHitEventInput,
  type SearchTripleHitInput,
} from "../search-cache.js";
import {
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexQueryResult,
} from "../../search-index/search-index.js";
import { WIKI_GRAPH_URI_PREFIX } from "../../../common/wiki-graph-uri.js";
import {
  isTextOnlySearch,
  queryRequiredSearchIndex,
} from "./search-hydration.js";
import {
  readArchivePage,
  type ArchivePageOptions,
} from "./pages.js";
import {
  createTextStreamIndex,
  getTextStreamIndex,
  readSourceFragment,
  readTextStreamRange,
} from "./text-streams.js";
import {
  formatChapterId,
  formatChapterTitleId,
  formatEdgeId,
  formatNodeId,
  formatSummaryId,
  formatTextStreamRangeUri,
  parseArchiveReference,
  parseWikiGraphReference,
} from "./references.js";
import type { WikiGraphReference } from "./references.js";
import {
  DEFAULT_FIND_LIMIT,
  ARCHIVE_ROOT_ID,
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
  matchText,
  createFindMatchFields,
  aggregateEvidenceScores,
  compareFindEvidenceHits,
  getSnippetNeedle,
  mergeStringLists,
  createCollectionResult,
  compareListHits,
  createNodePosition,
  createSentencePosition,
  compareSentenceIds,
  compareArchivePositions,
  compareNumbers,
  encodeFindCursor,
  decodeFindCursor,
  createSnippet,
  formatMetaSummary,
  formatMetaTitle,
  formatWeight,
  isDefined,
} from "./helpers.js";
import type { ArchiveTextSearch } from "./helpers.js";
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
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
  ArchiveTextStreamIndex,
  ArchiveTextStreamKind,
  ChapterState,
  EntityEvidenceMention,
  EvidenceReadContext,
  PositionedNodeLabel,
  SourceEvidenceRange,
  TextStreamHitRange,
} from "./types.js";

export { findArchiveObjects, grepArchiveObjects } from "./search.js";
export { readArchivePage, readArchiveText } from "./pages.js";
export type { ArchivePageOptions } from "./pages.js";

export {
  clearDirtyArchiveSearchIndex,
  createArchiveSearchIndexFingerprint,
  isArchiveSearchIndexCurrent,
  readArchiveSearchIndexStatus,
  rebuildArchiveSearchIndex,
} from "./index-state.js";

export {
  formatChapterId,
  formatEdgeId,
  formatNodeId,
  formatSummaryId,
} from "./references.js";

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
} from "./types.js";

export const DEFAULT_SOURCE_CONTEXT = 2;

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

export function findEntities(
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

export async function findTriples(
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

export function compareMentions(left: MentionRecord, right: MentionRecord): number {
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

export async function hydrateFindHitEvidence(
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

export async function hydrateFindResultBacklinks(
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

export function createFindEvidenceHydrationOptions(
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

export async function createTextStreamBacklinks(
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

export function isEntityOnlySearch(options: ArchiveFindOptions): boolean {
  return isEntitySearchTypes(options.types ?? null);
}

export function isEntitySearchTypes(types: readonly string[] | null): boolean {
  return types !== null && types.length === 1 && types[0] === "entity";
}

export function assertSearchCursorTypesMatch(
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

export function createEntitySearchCacheInput(
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

export async function createSentenceEvidenceSearchCacheInput(
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

export function parseEntityQid(id: string): string | undefined {
  const normalized = normalizeWikiGraphObjectUri(id);
  const prefix = `${WIKI_GRAPH_URI_PREFIX}entity/`;

  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : undefined;
}

export function filterLexicalHitsByMatch(
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

export async function findChapters(
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

export function selectEntityLabel(mentions: readonly MentionRecord[]): string {
  return selectEntityLabels(mentions)[0] ?? mentions[0]?.qid ?? "[entity]";
}

export function selectEntityLabels(
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

export async function createTriplePageLabel(
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

export async function listFragmentNodes(
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

export function findMeta(
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

export async function findNodes(
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

export async function requireChapter(
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

export async function createChapterState(
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

export async function requireNode(
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

export async function readNodeSourceFragments(
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

export async function createMentionEvidencePreview(
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

export async function createMentionLinkEvidencePreview(
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

export function filterMentionsByChapter(
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

export async function filterMentionLinksByChapter(
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

export function createEvidenceReadContext(): EvidenceReadContext {
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
