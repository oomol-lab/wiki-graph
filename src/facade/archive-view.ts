import type {
  ChunkRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
  ReadingEdgeRecord,
  SentenceId,
  SnakeRecord,
} from "../document/index.js";
import type { BookMeta } from "../source/index.js";

import {
  getGraphNode,
  listGraphNeighbors,
  type GraphNeighbor,
  type GraphNode,
} from "./graph.js";
import {
  getChapterTree,
  listChapters,
  type ChapterEntry,
  type ChapterTree,
} from "./chapter.js";
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
  decodeSearchSessionCursor,
  readCachedEntitySearchSessionPage,
  readCachedSearchSessionPage,
  readEntitySearchEvidenceMentions,
  readEntitySearchSessionPage,
  readSearchSessionDescriptor,
  readSearchSessionPage,
  type EntitySearchMentionHit,
} from "./search-cache.js";

export type ArchiveObjectType =
  | "chapter"
  | "chapter-tree"
  | "edge"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "summary"
  | "triple";

export type ArchiveCollectionType =
  | "chapter"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "summary"
  | "triple";

export type ArchiveFindObjectType =
  | "chapter"
  | "chapter-tree"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "summary"
  | "triple";

export type ArchiveFindFilterType =
  | "chapter"
  | "entity"
  | "fragment"
  | "node"
  | "summary"
  | "triple";

export interface ArchiveIndex {
  readonly chapters: readonly ChapterEntry[];
  readonly edgeCount: number;
  readonly meta: BookMeta | undefined;
  readonly nodeCount: number;
  readonly summaryCount: number;
}

export interface ArchiveFindHit {
  readonly chapter?: number;
  readonly evidence?: ArchiveFindEvidencePreview;
  readonly evidenceMentions?: readonly EntityEvidenceMention[];
  readonly field: ArchiveFindField;
  readonly id: string;
  readonly matchCount?: number;
  readonly matchedTerms?: readonly string[];
  readonly missingTerms?: readonly string[];
  readonly position?: ArchiveFindPosition;
  readonly score?: number;
  readonly snippet: string;
  readonly title: string;
  readonly type: ArchiveFindObjectType;
}

interface EntityEvidenceMention {
  readonly match: Pick<
    ArchiveFindHit,
    "matchCount" | "matchedTerms" | "missingTerms" | "score"
  >;
  readonly mention: MentionRecord;
}

export interface ArchiveFindEvidencePreview {
  readonly nextCursor: string | null;
  readonly shown: number;
  readonly sources: readonly ArchiveEvidenceItem[];
  readonly total: number;
}

export type ArchiveFindField =
  | "content"
  | "metadata"
  | "source"
  | "summary"
  | "title";

export interface ArchiveFindOptions {
  readonly archiveKey?: string;
  readonly chapters?: readonly number[];
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly match?: ArchiveFindMatch;
  readonly order?: ArchiveFindOrder;
  readonly types?: readonly ArchiveFindFilterType[];
}

export type ArchiveFindOrder = "doc-asc" | "doc-desc";
export type ArchiveFindMatch = "all" | "any";

export interface ArchiveFindPosition {
  readonly chapter: number;
  readonly fragment?: number;
}

export interface ArchiveFindResult {
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: ArchiveFindLens;
  readonly lensHint: ArchiveFindLensHint | null;
  readonly limit: number;
  readonly match: ArchiveFindMatch;
  readonly nextCursor: string | null;
  readonly order: ArchiveFindOrder;
  readonly query: string;
  readonly terms: readonly string[];
  readonly types: readonly ArchiveFindFilterType[] | null;
}

export type ArchiveFindLens = "broad" | "exact" | "typed";

export interface ArchiveFindLensHint {
  readonly lenses: {
    readonly chapter: string;
    readonly fragment: string;
    readonly node: string;
    readonly summary: string;
  };
  readonly message: string;
}

export interface ArchiveCollectionOptions {
  readonly chapters?: readonly number[];
  readonly cursor?: string;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly order?: ArchiveFindOrder;
  readonly types?: readonly ArchiveCollectionType[];
}

export interface ArchiveCollectionResult {
  readonly chapters: readonly number[] | null;
  readonly ids: readonly string[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly order: ArchiveFindOrder;
  readonly types: readonly ArchiveCollectionType[] | null;
}

export type ArchiveListKind =
  | "chapters"
  | "edges"
  | "fragments"
  | "meta"
  | "nodes"
  | "summaries";

export type ArchiveListItem =
  | {
      readonly id: string;
      readonly label: string;
      readonly summary: string;
      readonly type: Exclude<ArchiveObjectType, "triple">;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly objectLabel: string;
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectLabel: string;
      readonly subjectQid: string;
      readonly summary: string;
      readonly type: "triple";
    };

export type ArchivePage =
  | {
      readonly chapter: ChapterEntry;
      readonly id: string;
      readonly nodeGroups: readonly ArchiveNodeGroup[];
      readonly nodeCount: number;
      readonly summary: string | undefined;
      readonly summaryTruncated: boolean;
      readonly title: string;
      readonly type: "chapter";
    }
  | {
      readonly id: string;
      readonly title: string;
      readonly tree: ChapterTree;
      readonly type: "chapter-tree";
    }
  | {
      readonly generatedNodeSummary: string;
      readonly id: string;
      readonly incoming: readonly GraphNeighbor[];
      readonly neighbors: readonly GraphNeighbor[];
      readonly outgoing: readonly GraphNeighbor[];
      readonly position: ArchiveFindPosition | undefined;
      readonly sourceFragments: readonly ArchiveNodeSourceFragment[];
      readonly title: string;
      readonly type: "node";
    }
  | {
      readonly fragment: ArchiveSourceFragment;
      readonly id: string;
      readonly nextFragmentId: string | undefined;
      readonly nodes: readonly ArchiveNodeLabel[];
      readonly previousFragmentId: string | undefined;
      readonly title: string;
      readonly type: "fragment";
    }
  | {
      readonly content: string;
      readonly id: string;
      readonly title: string;
      readonly type: "summary";
    }
  | {
      readonly evidence: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly labels: readonly string[];
      readonly mentionCount: number;
      readonly qid: string;
      readonly type: "entity";
    }
  | {
      readonly evidence: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
      readonly type: "triple";
    }
  | {
      readonly id: string;
      readonly meta: BookMeta | undefined;
      readonly title: string;
      readonly type: "meta";
    };

export interface ArchiveEstimate {
  readonly estimatedCostUsd: {
    readonly max: number;
    readonly min: number;
  };
  readonly estimatedLlmCalls: number;
  readonly estimatedTime: {
    readonly maxSeconds: number;
    readonly minSeconds: number;
  };
  readonly estimatedTokens: {
    readonly input: number;
    readonly output: number;
  };
  readonly recommendation: string;
  readonly risk: "high" | "low" | "medium";
  readonly sourceWords: number;
  readonly targetStage: string;
}

export interface ArchivePack {
  readonly anchor: ArchivePage;
  readonly budget: number;
  readonly links: readonly GraphNeighbor[];
}

export interface ArchiveEvidence {
  readonly items: readonly ArchiveEvidenceItem[];
  readonly limit: number;
  readonly nextCursor: string | null;
}

export interface ArchiveEvidenceItem {
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly fragmentId: number;
  readonly id: string;
  readonly source: string;
  readonly startSentenceIndex: number;
  readonly title: string;
  readonly type: "source";
}

export interface ArchiveNodeGroup {
  readonly groupId: number;
  readonly nodeCount: number;
  readonly nodes: readonly ArchiveNodeLabel[];
}

export interface ArchiveNodeLabel {
  readonly id: string;
  readonly title: string;
}

interface PositionedNodeLabel {
  readonly label: ArchiveNodeLabel;
  readonly position: ArchiveFindPosition | undefined;
}

export interface ArchiveSourceFragment {
  readonly fragmentId: number;
  readonly id: string;
  readonly preview: string;
  readonly sentenceCount: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface ArchiveNodeSourceFragment {
  readonly id: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface ArchiveEvidenceOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export async function getArchiveIndex(
  document: ReadonlyDocument,
): Promise<ArchiveIndex> {
  const [chapters, meta, nodes, edges] = await Promise.all([
    listChapters(document),
    document.readBookMeta(),
    document.chunks.listAll(),
    document.readingEdges.listAll(),
  ]);

  return {
    chapters,
    edgeCount: edges.length,
    meta,
    nodeCount: nodes.length,
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
      return (await listChapters(document)).map((chapter) => ({
        id: formatChapterId(chapter.chapterId),
        label: chapter.title ?? "[untitled]",
        summary: `${chapter.stage}; ${chapter.fragmentCount} fragments`,
        type: "chapter",
      }));
    case "edges":
      return (await document.readingEdges.listAll()).map((edge) => ({
        id: formatEdgeId(edge),
        label: `${formatNodeId(edge.fromId)} -> ${formatNodeId(edge.toId)}`,
        summary: `weight ${formatWeight(edge.weight)}`,
        type: "edge",
      }));
    case "meta":
      return [
        {
          id: "meta:book",
          label: "Book metadata",
          summary: formatMetaSummary(await document.readBookMeta()),
          type: "meta",
        },
      ];
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
          (await listChapters(document)).map(async (chapter) =>
            (await listChapterSourceFragments(document, chapter.chapterId)).map(
              (fragment) => ({
                fragment,
                title: chapter.title ?? formatChapterId(chapter.chapterId),
              }),
            ),
          ),
        )
      )
        .flat()
        .map(({ fragment, title }) => ({
          id: fragment.id,
          label: title,
          summary: fragment.preview,
          type: "fragment" as const,
        }));
  }
}

export async function listArchiveCollection(
  document: ReadonlyDocument,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  const items: ArchiveFindHit[] = [];
  const chapterFilter =
    options.chapters === undefined ? undefined : new Set(options.chapters);
  const types = options.types ?? [
    "chapter",
    "entity",
    "node",
    "summary",
    "fragment",
    "triple",
  ];

  if (types.includes("meta")) {
    const meta = await document.readBookMeta();

    if (meta !== undefined) {
      items.push({
        field: "metadata",
        id: "meta:book",
        snippet: formatMetaSummary(meta),
        title: meta.title ?? "Book metadata",
        type: "meta",
      });
    }
  }

  if (types.includes("chapter") || types.includes("summary")) {
    for (const chapter of filterChapters(
      await listChapters(document),
      chapterFilter,
    )) {
      const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

      if (types.includes("chapter")) {
        items.push({
          chapter: chapter.chapterId,
          field: "title",
          id: formatChapterId(chapter.chapterId),
          position: { chapter: chapter.chapterId },
          snippet: `${chapter.stage}; ${chapter.fragmentCount} fragments`,
          title,
          type: "chapter",
        });
      }

      if (types.includes("summary")) {
        const summary = await document.readSummary(chapter.chapterId);

        if (summary !== undefined) {
          items.push({
            chapter: chapter.chapterId,
            field: "summary",
            id: formatSummaryId(chapter.chapterId),
            position: { chapter: chapter.chapterId },
            snippet: createSnippet(summary),
            title,
            type: "summary",
          });
        }
      }
    }
  }

  if (types.includes("fragment")) {
    for (const chapter of filterChapters(
      await listChapters(document),
      chapterFilter,
    )) {
      const title = chapter.title ?? formatChapterId(chapter.chapterId);

      for (const fragment of await listChapterSourceFragments(
        document,
        chapter.chapterId,
      )) {
        items.push({
          chapter: chapter.chapterId,
          field: "source",
          id: fragment.id,
          position: {
            chapter: chapter.chapterId,
            fragment: fragment.fragmentId,
          },
          snippet: fragment.preview,
          title,
          type: "fragment",
        });
      }
    }
  }

  if (types.includes("node")) {
    for (const node of await document.chunks.listAll()) {
      if (!isChapterAllowed(chapterFilter, node.sentenceId[0])) {
        continue;
      }

      const position = createNodePosition(node.sentenceIds);

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
      ),
    );
  }

  if (types.includes("triple")) {
    items.push(...(await listTripleCollection(document, chapterFilter)));
  }

  return createCollectionResult(items, options);
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

  if (options.cursor !== undefined) {
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
        )
      : await readSearchSessionPage(
          cursor.sessionId,
          cursor.offset,
          limit,
          options.archiveKey ?? "archive",
        );

    return {
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
    };
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

  const cacheInput = {
    archiveKey: options.archiveKey ?? "archive",
    chapters: options.chapters ?? null,
    lens: options.types === undefined ? "broad" : "typed",
    match: options.match ?? "any",
    order: options.order ?? "doc-asc",
    query,
    terms: search.terms,
    types: options.types ?? null,
  };

  if (isEntityOnlySearch(options)) {
    const cachedPage = await readCachedEntitySearchSessionPage(
      cacheInput,
      0,
      limit,
    );

    if (cachedPage !== undefined) {
      return {
        chapters: cachedPage.chapters,
        items: await hydrateFindHitEvidence(
          document,
          cachedPage.items,
          createFindEvidenceHydrationOptions(options, cachedPage.sessionId),
        ),
        lens: parseFindLens(cachedPage.lens),
        lensHint:
          cachedPage.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
        limit,
        match: parseFindMatch(cachedPage.match),
        nextCursor: cachedPage.nextCursor,
        order: options.order ?? "doc-asc",
        query: cachedPage.query,
        terms: cachedPage.terms,
        types: parseFindTypes(cachedPage.types),
      };
    }
  } else {
    const cachedPage = await readCachedSearchSessionPage(cacheInput, 0, limit);

    if (cachedPage !== undefined) {
      return {
        chapters: cachedPage.chapters,
        items: await hydrateFindHitEvidence(
          document,
          cachedPage.items,
          createFindEvidenceHydrationOptions(options),
        ),
        lens: parseFindLens(cachedPage.lens),
        lensHint:
          cachedPage.lens === "broad" ? BROAD_FIND_LENS_HINT : null,
        limit,
        match: parseFindMatch(cachedPage.match),
        nextCursor: cachedPage.nextCursor,
        order: options.order ?? "doc-asc",
        query: cachedPage.query,
        terms: cachedPage.terms,
        types: parseFindTypes(cachedPage.types),
      };
    }
  }

  const allMentions = wantsStructuredSearch
    ? await document.mentions.listBySurfaceTerms(
        listLexicalQueryCandidateTerms(query),
      )
    : [];
  const hits = await findArchiveObjectsUncached(document, search, options, {
    allMentions,
  });
  if (isEntityOnlySearch(options)) {
    const ranked = createRankedFindResult(
      query,
      filterLexicalHitsByMatch(hits, search, options.match ?? "any"),
      options,
      search.terms,
    );
    const sessionId = await createEntitySearchSession({
      archiveKey: options.archiveKey ?? "archive",
      chapters: ranked.chapters,
      hits: createEntitySearchMentionHits(ranked.items),
      lens: ranked.lens,
      match: ranked.match,
      order: ranked.order,
      query,
      terms: ranked.terms,
      types: ranked.types,
    });
    const firstPage = await readEntitySearchSessionPage(sessionId, 0, limit);

    return {
      ...ranked,
      items: await hydrateFindHitEvidence(
        document,
        firstPage.items,
        createFindEvidenceHydrationOptions(options, sessionId),
      ),
      nextCursor: firstPage.nextCursor,
    };
  }

  const ranked = createRankedFindResult(
    query,
    filterLexicalHitsByMatch(hits, search, options.match ?? "any"),
    options,
    search.terms,
  );
  const sessionId = await createSearchSession({
    archiveKey: options.archiveKey ?? "archive",
    chapters: ranked.chapters,
    items: ranked.items,
    lens: ranked.lens,
    match: ranked.match,
    order: ranked.order,
    query,
    records: hits,
    terms: ranked.terms,
    types: ranked.types,
  });
  const firstPage = await readSearchSessionPage(sessionId, 0, limit);

  return {
    ...ranked,
    items: await hydrateFindHitEvidence(
      document,
      firstPage.items,
      createFindEvidenceHydrationOptions(options),
    ),
    nextCursor: firstPage.nextCursor,
  };
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

async function findArchiveObjectsUncached(
  document: ReadonlyDocument,
  search: LexicalQuery,
  options: ArchiveFindOptions,
  context: {
    readonly allMentions: readonly MentionRecord[];
  },
): Promise<readonly ArchiveFindHit[]> {
  const requestedTypes = options.types ?? null;
  const shouldFindEntities =
    requestedTypes === null || requestedTypes.includes("entity");
  const shouldFindTriples =
    requestedTypes === null || requestedTypes.includes("triple");
  const hasStructuredTypeRequest = shouldFindEntities || shouldFindTriples;
  const hasTextTypeRequest =
    requestedTypes === null ||
    requestedTypes.includes("fragment") ||
    requestedTypes.includes("node") ||
    requestedTypes.includes("summary");
  const structuredHits = [
    ...(shouldFindEntities
      ? findEntities(search, { mentions: context.allMentions })
      : []),
    ...(shouldFindTriples
      ? await findTriples(document, search, { mentions: context.allMentions })
      : []),
  ];

  if (structuredHits.length > 0 && hasStructuredTypeRequest) {
    return structuredHits;
  }
  if (!hasTextTypeRequest) {
    return structuredHits;
  }

  const hits: ArchiveFindHit[] = [];

  hits.push(...findMetaLexical(await document.readBookMeta(), search));
  hits.push(...(await findChaptersLexical(document, search)));
  hits.push(...(await findNodesLexical(document, search)));

  return [...structuredHits, ...hits];
}

export async function readArchiveText(
  document: ReadonlyDocument,
  id: string,
): Promise<string> {
  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter":
      return (await listChapterSourceFragments(document, reference.id))
        .map((fragment) => fragment.text)
        .join("\n\n");
    case "fragment":
      return (
        await readSourceFragment(
          document,
          reference.serialId,
          reference.fragmentId,
        )
      ).text;
    case "summary": {
      const summary = await document.readSummary(reference.id);

      if (summary === undefined) {
        throw new Error(`Summary ${formatSummaryId(reference.id)} is missing.`);
      }

      return summary;
    }
    case "node": {
      const { node } = await requireNode(document, reference.id);

      return node.content;
    }
    case "meta": {
      const meta = await document.readBookMeta();

      return meta === undefined ? "" : JSON.stringify(meta, null, 2);
    }
  }
}

export async function readArchivePage(
  document: ReadonlyDocument,
  id: string,
): Promise<ArchivePage> {
  if (id.startsWith("wikigraph://")) {
    return await readWikiGraphPage(document, id);
  }

  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter": {
      const chapter = await requireChapter(document, reference.id);
      const [nodeGroups, nodes, summary] = await Promise.all([
        listChapterNodeGroups(document, reference.id),
        document.chunks.listBySerial(reference.id),
        document.readSummary(reference.id),
      ]);
      const summaryPreview =
        summary === undefined ? undefined : truncatePageSummary(summary);

      return {
        chapter,
        id: formatChapterId(reference.id),
        nodeCount: nodes.length,
        nodeGroups,
        summary: summaryPreview?.text,
        summaryTruncated: summaryPreview?.truncated ?? false,
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "chapter",
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
        id: "meta:book",
        meta: await document.readBookMeta(),
        title: "Book metadata",
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
      const content = await document.readSummary(reference.id);

      if (content === undefined) {
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
): Promise<ArchivePage> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter":
      return await readArchivePage(
        document,
        formatChapterId(reference.chapterId),
      );
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
        evidence: await createMentionEvidencePreview(document, mentions),
        id: uri,
        label: selectEntityLabel(mentions),
        labels: selectEntityLabels(mentions),
        mentionCount: mentions.length,
        qid: reference.qid,
        type: "entity",
      };
    }
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
        evidence: await createMentionLinkEvidencePreview(document, links),
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
      return await readArchivePage(document, formatNodeId(reference.id));
    }
    case "source":
      return {
        fragment: await createSourceRangeFragment(document, reference),
        id: uri,
        nextFragmentId: undefined,
        nodes: [],
        previousFragmentId: undefined,
        title: uri,
        type: "fragment",
      };
    case "summary":
      return await readArchivePage(
        document,
        formatSummaryId(reference.chapterId),
      );
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
): Promise<readonly ArchiveListItem[]> {
  if (id.startsWith("wikigraph://")) {
    return await listRelatedWikiGraphObjects(document, id);
  }

  const reference = parseArchiveReference(id);
  if (reference.type !== "node") {
    return [];
  }

  const { chapterId } = await requireNode(document, reference.id);

  return (await listGraphNeighbors(document, chapterId, reference.id)).map(
    (neighbor) => ({
      id: formatNodeId(neighbor.node.id),
      label: neighbor.node.label,
      summary: neighbor.node.content,
      type: "node",
    }),
  );
}

async function listRelatedWikiGraphObjects(
  document: ReadonlyDocument,
  uri: string,
): Promise<readonly ArchiveListItem[]> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter": {
      const chapter = await requireChapter(document, reference.chapterId);
      const items: ArchiveListItem[] = [
        {
          id: `fragment:${reference.chapterId}:0`,
          label: "Source",
          summary: `${chapter.fragmentCount} fragments`,
          type: "fragment",
        },
      ];
      const summary = await document.readSummary(reference.chapterId);

      if (summary !== undefined) {
        items.push({
          id: formatSummaryId(reference.chapterId),
          label: "Summary",
          summary: createSnippet(summary),
          type: "summary",
        });
      }

      return items;
    }
    case "chunk": {
      const { chapterId } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }

      return (await listGraphNeighbors(document, chapterId, reference.id)).map(
        (neighbor) => ({
          id: formatNodeId(neighbor.node.id),
          label: neighbor.node.label,
          summary: neighbor.node.content,
          type: "node",
        }),
      );
    }
    case "source":
    case "summary": {
      const chapter = await requireChapter(document, reference.chapterId);

      return [
        {
          id: formatChapterId(reference.chapterId),
          label: chapter.title ?? `[chapter ${reference.chapterId}]`,
          summary: `${chapter.stage}; ${chapter.fragmentCount} fragments`,
          type: "chapter",
        },
      ];
    }
    case "entity":
      return await listRelatedEntityObjects(document, reference);
    case "triple":
      return await listRelatedTripleObjects(document, reference);
    case "chapter-tree":
      return [];
  }
}

async function listRelatedEntityObjects(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "entity" }>,
): Promise<readonly ArchiveListItem[]> {
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
  const triplesById = new Map<string, ArchiveListItem>();

  for (const chapterId of chapters) {
    for (const link of await document.mentionLinks.listByChapter(chapterId)) {
      const [source, target] = await Promise.all([
        document.mentions.getById(link.sourceMentionId),
        document.mentions.getById(link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }
      if (source.qid !== reference.qid && target.qid !== reference.qid) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);

      if (triplesById.has(id)) {
        continue;
      }

      triplesById.set(id, {
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

  return [...triplesById.values()];
}

async function listRelatedTripleObjects(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "triple" }>,
): Promise<readonly ArchiveListItem[]> {
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
    throw new Error(
      `Triple ${formatTripleUri(reference.subjectQid, reference.predicate, reference.objectQid)} was not found in this archive.`,
    );
  }

  return await Promise.all([
    createRelatedEntityItem(document, reference.subjectQid),
    createRelatedEntityItem(document, reference.objectQid),
  ]);
}

async function createRelatedEntityItem(
  document: ReadonlyDocument,
  qid: string,
): Promise<ArchiveListItem> {
  const mentions = await document.mentions.listByQid(qid);

  return {
    id: formatEntityUri(qid),
    label: mentions.length === 0 ? qid : selectEntityLabel(mentions),
    summary: `${mentions.length} mentions`,
    type: "entity",
  };
}

export async function listArchiveEvidence(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter":
    case "chapter-tree":
    case "source":
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
    case "summary":
      return {
        items: [
          await createSourceEvidenceItem(
            document,
            reference.chapterId,
            0,
            Number.POSITIVE_INFINITY,
          ),
        ],
        limit: options.limit ?? DEFAULT_FIND_LIMIT,
        nextCursor: null,
      };
    case "triple":
      return await createSourceEvidencePage(
        document,
        await createMentionLinkEvidenceRanges(
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
  const anchor = await readArchivePage(document, id);
  const links = await listAllArchiveLinks(document, id);

  return {
    anchor,
    budget,
    links,
  };
}

export async function estimateArchiveBuild(
  document: ReadonlyDocument,
  targetStage: string,
): Promise<ArchiveEstimate> {
  const chapters = await listChapters(document);
  const words = await estimateSourceWords(document, chapters);
  const pendingGraph = chapters.filter(
    (chapter) => chapter.stage === "sourced",
  ).length;
  const pendingSummary = chapters.filter(
    (chapter) => chapter.stage === "graphed",
  ).length;
  const planned = chapters.filter(
    (chapter) => chapter.stage === "planned",
  ).length;
  const targetCalls =
    targetStage === "source" || targetStage === "sourced"
      ? 0
      : Math.max(0, pendingGraph + pendingSummary + planned);
  const inputTokens = Math.ceil(words * 1.5);
  const outputTokens = Math.ceil(words * 0.35);
  const risk =
    inputTokens > 1_000_000 || targetCalls > 100
      ? "high"
      : inputTokens > 150_000 || targetCalls > 20
        ? "medium"
        : "low";

  return {
    estimatedCostUsd: {
      max: roundMoney(
        (inputTokens / 1_000_000) * 6 + (outputTokens / 1_000_000) * 18,
      ),
      min: roundMoney(
        (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 3,
      ),
    },
    estimatedLlmCalls: targetCalls,
    estimatedTime: {
      maxSeconds: targetCalls * 120,
      minSeconds: targetCalls * 30,
    },
    estimatedTokens: {
      input: inputTokens,
      output: outputTokens,
    },
    recommendation:
      risk === "high"
        ? "Do not queue broad generation in an interactive agent session; queue scoped chapters first."
        : "Estimate is low enough for scoped queue work if the user expects LLM-backed generation.",
    risk,
    sourceWords: words,
    targetStage,
  };
}

export function formatChapterId(chapterId: number): string {
  return `chapter:${chapterId}`;
}

export function formatEdgeId(edge: ReadingEdgeRecord): string {
  return `edge:${edge.fromId}->${edge.toId}`;
}

export function formatNodeId(nodeId: number): string {
  return `node:${nodeId}`;
}

export function formatSummaryId(chapterId: number): string {
  return `summary:${chapterId}`;
}

export function formatFragmentId(serialId: number, fragmentId: number): string {
  return `fragment:${serialId}:${fragmentId}`;
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
        id: `wikigraph://entity/${mention.qid}`,
        ...createFindMatchFields(match),
        position: {
          chapter: mention.chapterId,
          fragment: mention.fragmentId,
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
        field: "content" as const,
        id,
        ...createFindMatchFields(match),
        position: {
          chapter: source.chapterId,
          fragment: source.fragmentId,
        },
        snippet: link.note ?? text,
        title: text,
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
  return (
    await Promise.all(
      (await listChapters(document)).map(
        async (chapter) =>
          await document.mentions.listByChapter(chapter.chapterId),
      ),
    )
  ).flat();
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
    score: aggregateEvidenceScores(
      rankedHits.map((hit) => hit.score ?? 0),
    ),
  };
}

function listEntityCollection(
  mentions: readonly MentionRecord[],
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
      id: `wikigraph://entity/${qid}`,
      position: {
        chapter: first.chapterId,
        fragment: first.fragmentId,
      },
      snippet: `${qidMentions.length} mentions`,
      title: selectEntityLabel(qidMentions),
      type: "entity",
    };
  });
}

async function listTripleCollection(
  document: ReadonlyDocument,
  chapterFilter?: ReadonlySet<number>,
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

      if (hitsById.has(id)) {
        continue;
      }

      hitsById.set(id, {
        chapter: source.chapterId,
        field: "title",
        id,
        position: {
          chapter: source.chapterId,
          fragment: source.fragmentId,
        },
        snippet: `${source.surface} ${link.predicate} ${target.surface}`,
        title: `${source.qid} ${link.predicate} ${target.qid}`,
        type: "triple",
      });
    }
  }

  return [...hitsById.values()];
}

function compareMentions(left: MentionRecord, right: MentionRecord): number {
  return (
    compareNumbers(left.chapterId, right.chapterId) ||
    compareNumbers(left.fragmentId, right.fragmentId) ||
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
    readonly sessionId?: string;
  } = {},
): Promise<readonly ArchiveFindHit[]> {
  return await Promise.all(
    hits.map(async (hit) => {
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
        );
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
      );
      const { evidenceMentions: _evidenceMentions, ...publicHit } = hit;

      return {
        ...publicHit,
        evidence,
      };
    }),
  );
}

function createFindEvidenceHydrationOptions(
  options: ArchiveFindOptions,
  sessionId?: string,
): {
  readonly evidenceLimit?: number;
  readonly sessionId?: string;
} {
  return {
    ...(options.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: options.evidenceLimit }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
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
): Promise<ArchiveFindHit> {
  if (evidenceLimit === undefined) {
    const { evidence: _evidence, ...publicHit } = hit;

    return publicHit;
  }

  const qid = parseEntityQid(hit.id);

  if (qid === undefined) {
    return hit;
  }

  const allMentions = (
    await readEntitySearchEvidenceMentions(sessionId, qid, 10_000)
  ).map(toMentionRecord);
  const ranges = await createMentionEvidenceRanges(document, allMentions);
  const mergedRanges = mergeSourceEvidenceRanges(ranges);
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
            range.fragmentId,
          ),
      ),
  );

  return {
    ...hit,
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
  return `wikigraph://triple/${subjectQid}/${encodeURIComponent(predicate)}/${objectQid}`;
}

function formatEntityUri(qid: string): string {
  return `wikigraph://entity/${qid}`;
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

function createEntitySearchMentionHits(
  hits: readonly ArchiveFindHit[],
): readonly EntitySearchMentionHit[] {
  return hits.flatMap((hit) => {
    if (hit.type !== "entity" || hit.evidenceMentions === undefined) {
      return [];
    }

    return hit.evidenceMentions.map((evidenceMention) => ({
      chapterId: evidenceMention.mention.chapterId,
      ...(evidenceMention.mention.confidence === undefined
        ? {}
        : { confidence: evidenceMention.mention.confidence }),
      fragmentId: evidenceMention.mention.fragmentId,
      matchCount: evidenceMention.match.matchCount ?? 0,
      matchedTerms: evidenceMention.match.matchedTerms ?? [],
      mentionId: evidenceMention.mention.id,
      missingTerms: evidenceMention.match.missingTerms ?? [],
      ...(evidenceMention.mention.note === undefined
        ? {}
        : { note: evidenceMention.mention.note }),
      qid: evidenceMention.mention.qid,
      rangeEnd: evidenceMention.mention.rangeEnd,
      rangeStart: evidenceMention.mention.rangeStart,
      resultScore: hit.score ?? 0,
      score: evidenceMention.match.score ?? 0,
      ...(evidenceMention.mention.sentenceIndex === undefined
        ? {}
        : { sentenceIndex: evidenceMention.mention.sentenceIndex }),
      surface: evidenceMention.mention.surface,
    }));
  });
}

function toMentionRecord(hit: EntitySearchMentionHit): MentionRecord {
  return {
    chapterId: hit.chapterId,
    ...(hit.confidence === undefined ? {} : { confidence: hit.confidence }),
    fragmentId: hit.fragmentId,
    id: hit.mentionId,
    ...(hit.note === undefined ? {} : { note: hit.note }),
    qid: hit.qid,
    rangeEnd: hit.rangeEnd,
    rangeStart: hit.rangeStart,
    ...(hit.sentenceIndex === undefined
      ? {}
      : { sentenceIndex: hit.sentenceIndex }),
    surface: hit.surface,
  };
}

function parseEntityQid(id: string): string | undefined {
  const prefix = "wikigraph://entity/";

  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
}

function findMetaLexical(
  meta: BookMeta | undefined,
  search: LexicalQuery,
): readonly ArchiveFindHit[] {
  if (meta === undefined) {
    return [];
  }

  const fields = [
    meta.title,
    ...meta.authors,
    meta.description,
    meta.identifier,
    meta.language,
    meta.publishedAt,
    meta.publisher,
    meta.sourceFormat,
  ].filter(isDefined);
  const content = fields.join("\n");
  const contentMatch = scoreLexicalText(content, search);

  if (contentMatch === undefined) {
    return [];
  }

  return [
    {
      field: "metadata",
      id: "meta:book",
      ...createFindMatchFields(contentMatch),
      snippet: createSnippet(content, contentMatch.snippetNeedle),
      title: meta.title ?? "Book metadata",
      type: "meta",
    },
  ];
}

function filterLexicalHitsByMatch(
  hits: readonly ArchiveFindHit[],
  search: LexicalQuery,
  match: ArchiveFindMatch,
): readonly ArchiveFindHit[] {
  if (match === "any") {
    return hits;
  }

  const requiredTerms = [
    ...search.phrases,
  ];

  if (requiredTerms.length === 0) {
    return hits;
  }

  return hits.filter((hit) =>
    requiredTerms.every((term) => hit.matchedTerms?.includes(term) === true),
  );
}

async function findChaptersLexical(
  document: ReadonlyDocument,
  search: LexicalQuery,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const chapter of await listChapters(document)) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;
    const titleMatch = scoreLexicalText(title, search);

    if (titleMatch !== undefined) {
      hits.push({
        chapter: chapter.chapterId,
        field: "title",
        id: formatChapterId(chapter.chapterId),
        ...createFindMatchFields(titleMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: title,
        title,
        type: "chapter",
      });
    }

    const summary = await document.readSummary(chapter.chapterId);
    const summaryMatch =
      summary === undefined ? undefined : scoreLexicalText(summary, search);

    if (summary !== undefined && summaryMatch !== undefined) {
      hits.push({
        chapter: chapter.chapterId,
        field: "summary",
        id: formatSummaryId(chapter.chapterId),
        ...createFindMatchFields(summaryMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: createSnippet(summary, summaryMatch.snippetNeedle),
        title,
        type: "summary",
      });
    }

    for (const fragment of await listChapterSourceFragments(
      document,
      chapter.chapterId,
    )) {
      const fragmentMatch = scoreLexicalText(fragment.text, search);

      if (fragmentMatch !== undefined) {
        hits.push({
          chapter: chapter.chapterId,
          field: "source",
          id: fragment.id,
          ...createFindMatchFields(fragmentMatch),
          position: {
            chapter: chapter.chapterId,
            fragment: fragment.fragmentId,
          },
          snippet: createSnippet(fragment.text, fragmentMatch.snippetNeedle),
          title,
          type: "fragment",
        });
      }
    }
  }

  return hits;
}

async function findNodesLexical(
  document: ReadonlyDocument,
  search: LexicalQuery,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const node of await document.chunks.listAll()) {
    const position = createNodePosition(node.sentenceIds);
    const labelMatch = scoreLexicalText(node.label, search);

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
    const contentMatch = scoreLexicalText(node.content, search);

    if (contentMatch !== undefined) {
      hits.push({
        chapter: node.sentenceId[0],
        field: "content",
        id: formatNodeId(node.id),
        ...createFindMatchFields(contentMatch),
        ...(position === undefined ? {} : { position }),
        snippet: createSnippet(node.content, contentMatch.snippetNeedle),
        title: node.label,
        type: "node",
      });
    }
  }

  return hits;
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
        id: formatChapterId(chapter.chapterId),
        ...createFindMatchFields(titleMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: title,
        title,
        type: "chapter",
      });
    }

    const summary = await document.readSummary(chapter.chapterId);
    const summaryMatch =
      summary === undefined ? undefined : matchText(summary, search);

    if (summary !== undefined && summaryMatch !== undefined) {
      hits.push({
        chapter: chapter.chapterId,
        field: "summary",
        id: formatSummaryId(chapter.chapterId),
        ...createFindMatchFields(summaryMatch),
        position: {
          chapter: chapter.chapterId,
        },
        snippet: createSnippet(summary, getSnippetNeedle(summaryMatch)),
        title,
        type: "summary",
      });
    }

    for (const fragment of await listChapterSourceFragments(
      document,
      chapter.chapterId,
    )) {
      const fragmentMatch = matchText(fragment.text, search);

      if (fragmentMatch !== undefined) {
        hits.push({
          chapter: chapter.chapterId,
          field: "source",
          id: fragment.id,
          ...createFindMatchFields(fragmentMatch),
          position: {
            chapter: chapter.chapterId,
            fragment: fragment.fragmentId,
          },
          snippet: createSnippet(
            fragment.text,
            getSnippetNeedle(fragmentMatch),
          ),
          title,
          type: "fragment",
        });
      }
    }
  }

  return hits;
}

async function listChapterSourceFragments(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly ArchiveSourceFragment[]> {
  const fragments = document.getSerialFragments(chapterId);

  return await Promise.all(
    (await fragments.listFragmentIds()).map(async (fragmentId) => {
      const fragment = await fragments.getFragment(fragmentId);
      const text = fragment.sentences
        .map((sentence) => sentence.text)
        .join("\n");

      return {
        fragmentId,
        id: formatFragmentId(chapterId, fragmentId),
        preview: createSnippet(text),
        sentenceCount: fragment.sentences.length,
        text,
        wordsCount: fragment.sentences.reduce(
          (total, sentence) => total + sentence.wordsCount,
          0,
        ),
      };
    }),
  );
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

async function createSourceRangeFragment(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "source" }>,
): Promise<ArchiveSourceFragment> {
  const evidence = await createSourceEvidenceItem(
    document,
    reference.chapterId,
    reference.startSentenceIndex,
    reference.endSentenceIndex,
    reference.fragmentId,
  );

  return {
    fragmentId: evidence.fragmentId,
    id: evidence.id,
    preview: createSnippet(evidence.source),
    sentenceCount: evidence.endSentenceIndex - evidence.startSentenceIndex + 1,
    text: evidence.source,
    wordsCount: countWords(evidence.source),
  };
}

function selectEntityLabel(mentions: readonly MentionRecord[]): string {
  return selectEntityLabels(mentions)[0] ?? mentions[0]?.qid ?? "[entity]";
}

function selectEntityLabels(mentions: readonly MentionRecord[]): readonly string[] {
  const counts = new Map<string, number>();

  for (const mention of mentions) {
    counts.set(mention.surface, (counts.get(mention.surface) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => {
    const countComparison = right[1] - left[1];

    return countComparison === 0
      ? left[0].localeCompare(right[0])
      : countComparison;
  }).map(([label]) => label);
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

async function listChapterNodeGroups(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly ArchiveNodeGroup[]> {
  const snakes = await document.snakes.listBySerial(chapterId);

  if (snakes.length === 0) {
    return listChapterNodeGroupsByFragment(document, chapterId);
  }

  return (
    await Promise.all(
      snakes.map(async (snake) =>
        createArchiveNodeGroup({
          groupId: snake.localSnakeId,
          nodes: await listSnakeNodeLabels(document, snake),
        }),
      ),
    )
  ).filter((group) => group.nodeCount > 0);
}

async function listChapterNodeGroupsByFragment(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly ArchiveNodeGroup[]> {
  const nodes = (await document.chunks.listBySerial(chapterId))
    .map(createPositionedNodeLabel)
    .sort(comparePositionedNodeLabels);
  const nodesByFragment = new Map<number, ArchiveNodeLabel[]>();

  for (const node of nodes) {
    const fragmentId = node.position?.fragment ?? -1;
    const groupNodes = nodesByFragment.get(fragmentId) ?? [];

    groupNodes.push(node.label);
    nodesByFragment.set(fragmentId, groupNodes);
  }

  return [...nodesByFragment.entries()]
    .sort(([leftFragment], [rightFragment]) =>
      compareNumbers(leftFragment, rightFragment),
    )
    .map(([, groupNodes], index) =>
      createArchiveNodeGroup({
        groupId: index,
        nodes: groupNodes,
      }),
    );
}

function createArchiveNodeGroup(input: {
  readonly groupId: number;
  readonly nodes: readonly ArchiveNodeLabel[];
}): ArchiveNodeGroup {
  return {
    groupId: input.groupId,
    nodeCount: input.nodes.length,
    nodes: input.nodes,
  };
}

async function listSnakeNodeLabels(
  document: ReadonlyDocument,
  snake: SnakeRecord,
): Promise<readonly ArchiveNodeLabel[]> {
  return (
    await Promise.all(
      (await document.snakeChunks.listChunkIds(snake.id)).map(
        async (chunkId) => {
          const chunk = await document.chunks.getById(chunkId);

          return chunk === undefined
            ? undefined
            : createPositionedNodeLabel(chunk);
        },
      ),
    )
  )
    .filter(isDefined)
    .sort(comparePositionedNodeLabels)
    .map(({ label }) => label);
}

async function listFragmentNodes(
  document: ReadonlyDocument,
  chapterId: number,
  fragmentId: number,
): Promise<readonly ArchiveNodeLabel[]> {
  return (await document.chunks.listByFragments(chapterId, [fragmentId]))
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
    meta.identifier,
    meta.language,
    meta.publishedAt,
    meta.publisher,
    meta.sourceFormat,
  ].filter(isDefined);
  const content = fields.join("\n");
  const contentMatch = matchText(content, search);

  if (contentMatch === undefined) {
    return [];
  }

  return [
    {
      field: "metadata",
      id: "meta:book",
      ...createFindMatchFields(contentMatch),
      snippet: createSnippet(content, getSnippetNeedle(contentMatch)),
      title: meta.title ?? "Book metadata",
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

async function estimateSourceWords(
  document: ReadonlyDocument,
  chapters: readonly ChapterEntry[],
): Promise<number> {
  let words = 0;

  for (const chapter of chapters) {
    const fragments = document.getSerialFragments(chapter.chapterId);

    for (const fragmentId of await fragments.listFragmentIds()) {
      const fragment = await fragments.getFragment(fragmentId);

      words += fragment.sentences.reduce(
        (total, sentence) => total + sentence.wordsCount,
        0,
      );
    }
  }

  return words;
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
  return await Promise.all(
    collectNodeSourceFragmentIds(node).map(async ([chapterId, fragmentId]) => {
      const fragment = await readSourceFragment(
        document,
        chapterId,
        fragmentId,
      );
      const text = truncateSourceExcerpt(fragment.text);

      return {
        id: fragment.id,
        text,
        truncated: text.length < fragment.text.length,
      };
    }),
  );
}

function collectNodeSourceFragmentIds(
  node: Pick<GraphNode, "sentenceIds">,
): readonly (readonly [number, number])[] {
  const seen = new Set<string>();
  const fragmentIds: (readonly [number, number])[] = [];

  for (const [chapterId, fragmentId] of node.sentenceIds) {
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
  readonly fragmentId: number;
  readonly startSentenceIndex: number;
}> {
  const ranges = new Map<string, [number, number]>();

  for (const [chapterId, fragmentId, sentenceIndex] of node.sentenceIds) {
    const key = `${chapterId}:${fragmentId}`;
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
    const { chapterId, fragmentId } = parseEvidenceRangeKey(key);
    return {
      chapterId,
      endSentenceIndex: end,
      fragmentId,
      startSentenceIndex: start,
    };
  });
}

async function createMentionEvidencePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    await createMentionEvidenceRanges(document, mentions),
    limit,
  );
}

async function createMentionEvidenceRanges(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
): Promise<
  Array<{
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly fragmentId: number;
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
          mention.fragmentId,
          mention.rangeStart,
        ));
      const endSentenceIndex =
        mention.sentenceIndex ??
        (await findSentenceIndexAtOffset(
          document,
          mention.chapterId,
          mention.fragmentId,
          Math.max(0, mention.rangeEnd - 1),
        ));

      return {
        chapterId: mention.chapterId,
        endSentenceIndex,
        fragmentId: mention.fragmentId,
        startSentenceIndex,
      };
    }),
  );
}

async function createMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidencePreview(
    document,
    await createMentionLinkEvidenceRanges(document, links),
    limit,
  );
}

async function createMentionLinkEvidenceRanges(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
): Promise<
  Array<{
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly fragmentId: number;
    readonly startSentenceIndex: number;
  }>
> {
  return (
    await Promise.all(
      links.map(async (link) => {
        const [source, target] = await Promise.all([
          document.mentions.getById(link.sourceMentionId),
          document.mentions.getById(link.targetMentionId),
        ]);

        if (source === undefined || target === undefined) {
          return undefined;
        }

        const chapterId = source.chapterId;
        const fragmentId = source.fragmentId;
        const sourceSentenceIndex =
          source.sentenceIndex ??
          (await findSentenceIndexAtOffset(
            document,
            chapterId,
            fragmentId,
            source.rangeStart,
          ));
        const targetSentenceIndex =
          target.chapterId === chapterId && target.fragmentId === fragmentId
            ? (target.sentenceIndex ??
              (await findSentenceIndexAtOffset(
                document,
                chapterId,
                fragmentId,
                target.rangeStart,
              )))
            : sourceSentenceIndex;
        const evidenceStart = link.evidenceStart;
        const evidenceEnd = link.evidenceEnd;
        const startSentenceIndex =
          evidenceStart === undefined
            ? Math.min(sourceSentenceIndex, targetSentenceIndex)
            : await findSentenceIndexAtOffset(
                document,
                chapterId,
                fragmentId,
                evidenceStart,
              );
        const endSentenceIndex =
          evidenceEnd === undefined
            ? Math.max(sourceSentenceIndex, targetSentenceIndex)
            : await findSentenceIndexAtOffset(
                document,
                chapterId,
                fragmentId,
                Math.max(0, evidenceEnd - 1),
              );

        return {
          chapterId,
          endSentenceIndex,
          fragmentId,
          startSentenceIndex,
        };
      }),
    )
  ).filter(isDefined);
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
  ranges: readonly {
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly fragmentId: number;
    readonly startSentenceIndex: number;
  }[],
  options: ArchiveEvidenceOptions,
): Promise<ArchiveEvidence> {
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const start = decodeFindCursor(options.cursor);
  const mergedRanges = mergeSourceEvidenceRanges(ranges);
  const pageRanges = mergedRanges.slice(start, start + limit);
  const nextOffset = start + pageRanges.length;
  const items = await Promise.all(
    pageRanges.map(
      async (range) =>
        await createSourceEvidenceItem(
          document,
          range.chapterId,
          range.startSentenceIndex,
          range.endSentenceIndex,
          range.fragmentId,
        ),
    ),
  );

  return {
    items,
    limit,
    nextCursor:
      nextOffset < mergedRanges.length ? encodeFindCursor(nextOffset) : null,
  };
}

async function createSourceEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly {
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly fragmentId: number;
    readonly startSentenceIndex: number;
  }[],
  limit: number,
): Promise<ArchiveFindEvidencePreview> {
  const mergedRanges = mergeSourceEvidenceRanges(ranges);
  const sources = await Promise.all(
    mergedRanges
      .slice(0, limit)
      .map(
        async (range) =>
          await createSourceEvidenceItem(
            document,
            range.chapterId,
            range.startSentenceIndex,
            range.endSentenceIndex,
            range.fragmentId,
          ),
      ),
  );

  return {
    nextCursor:
      sources.length < mergedRanges.length
        ? encodeFindCursor(sources.length)
        : null,
    shown: sources.length,
    sources,
    total: mergedRanges.length,
  };
}

function mergeSourceEvidenceRanges(
  ranges: readonly {
    readonly chapterId: number;
    readonly endSentenceIndex: number;
    readonly fragmentId: number;
    readonly startSentenceIndex: number;
  }[],
): Array<{
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly fragmentId: number;
  readonly startSentenceIndex: number;
}> {
  const rangesBySource = new Map<string, Array<[number, number]>>();

  for (const range of ranges) {
    const key = `${range.chapterId}:${range.fragmentId}`;
    const sourceRanges = rangesBySource.get(key) ?? [];

    sourceRanges.push([range.startSentenceIndex, range.endSentenceIndex]);
    rangesBySource.set(key, sourceRanges);
  }

  return [...rangesBySource.entries()].flatMap(([key, ranges]) => {
    const { chapterId, fragmentId } = parseEvidenceRangeKey(key);

    return mergeEvidenceRanges(ranges).map(
      ([start, end]) =>
        ({
          chapterId,
          endSentenceIndex: end,
          fragmentId,
          startSentenceIndex: start,
        }) as const,
    );
  });
}

async function createSourceEvidenceItem(
  document: ReadonlyDocument,
  chapterId: number,
  startSentenceIndex: number,
  endSentenceIndex: number,
  fragmentId?: number,
): Promise<ArchiveEvidenceItem> {
  const chapter = await requireChapter(document, chapterId);
  const resolvedFragmentId =
    fragmentId ??
    (await document.getSerialFragments(chapterId).listFragmentIds())[0];

  if (resolvedFragmentId === undefined) {
    throw new Error(`Chapter ${formatChapterId(chapterId)} has no source.`);
  }

  const fragment = await document
    .getSerialFragments(chapterId)
    .getFragment(resolvedFragmentId);
  const lastSentenceIndex = Math.max(0, fragment.sentences.length - 1);
  const start = clampInteger(startSentenceIndex, 0, lastSentenceIndex);
  const end = clampInteger(endSentenceIndex, start, lastSentenceIndex);
  const source = fragment.sentences
    .slice(start, end + 1)
    .map((sentence) => sentence.text)
    .join("\n");

  return {
    chapterId,
    endSentenceIndex: end,
    fragmentId: resolvedFragmentId,
    id: formatSourceRangeUri(chapterId, resolvedFragmentId, start, end),
    source,
    startSentenceIndex: start,
    title: chapter.title ?? `[chapter ${chapterId}]`,
    type: "source",
  };
}

async function findSentenceIndexAtOffset(
  document: ReadonlyDocument,
  chapterId: number,
  fragmentId: number,
  offset: number,
): Promise<number> {
  const fragment = await document
    .getSerialFragments(chapterId)
    .getFragment(fragmentId);
  let cursor = 0;

  for (let index = 0; index < fragment.sentences.length; index += 1) {
    const sentence = fragment.sentences[index];

    if (sentence === undefined) {
      continue;
    }

    const nextCursor = cursor + sentence.text.length;

    if (offset <= nextCursor) {
      return index;
    }

    cursor = nextCursor + 1;
  }

  return Math.max(0, fragment.sentences.length - 1);
}

function formatSourceRangeUri(
  chapterId: number,
  fragmentId: number,
  startSentenceIndex: number,
  endSentenceIndex: number,
): string {
  return `wikigraph://chapter/${chapterId}/source/${fragmentId}#${startSentenceIndex}..${endSentenceIndex}`;
}

function mergeEvidenceRanges(
  ranges: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  const sortedRanges = [...ranges]
    .map(
      ([start, end]) => [Math.min(start, end), Math.max(start, end)] as const,
    )
    .sort(([leftStart, leftEnd], [rightStart, rightEnd]) =>
      leftStart === rightStart ? leftEnd - rightEnd : leftStart - rightStart,
    );
  const mergedRanges: Array<[number, number]> = [];

  for (const [start, end] of sortedRanges) {
    const last = mergedRanges.at(-1);

    if (last === undefined || start > last[1] + 1) {
      mergedRanges.push([start, end]);
    } else {
      last[1] = Math.max(last[1], end);
    }
  }

  return mergedRanges;
}

function parseEvidenceRangeKey(key: string): {
  readonly chapterId: number;
  readonly fragmentId: number;
} {
  const [chapterId, fragmentId] = key.split(":").map(Number);

  if (chapterId === undefined || fragmentId === undefined) {
    throw new Error("Internal error: invalid source evidence range.");
  }

  return { chapterId, fragmentId };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

type WikiGraphReference =
  | {
      readonly chapterId: number;
      readonly type: "chapter";
    }
  | {
      readonly type: "chapter-tree";
    }
  | {
      readonly chapterId?: number;
      readonly id: number;
      readonly type: "chunk";
    }
  | {
      readonly chapterId: number;
      readonly endSentenceIndex: number;
      readonly fragmentId?: number;
      readonly startSentenceIndex: number;
      readonly type: "source";
    }
  | {
      readonly chapterId: number;
      readonly endSentenceIndex: number;
      readonly startSentenceIndex: number;
      readonly type: "summary";
    }
  | {
      readonly chapterId?: number;
      readonly qid: string;
      readonly type: "entity";
    }
  | {
      readonly chapterId?: number;
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
      readonly type: "triple";
    };

function parseWikiGraphReference(uri: string): WikiGraphReference {
  if (!uri.startsWith("wikigraph://")) {
    const archiveReference = parseArchiveReference(uri);

    switch (archiveReference.type) {
      case "node":
        return { id: archiveReference.id, type: "chunk" };
      case "chapter":
        return { chapterId: archiveReference.id, type: "chapter" };
      case "summary":
        return {
          chapterId: archiveReference.id,
          endSentenceIndex: Number.POSITIVE_INFINITY,
          startSentenceIndex: 0,
          type: "summary",
        };
      case "fragment":
      case "meta":
        throw new Error(`Evidence is not available for ${uri}.`);
    }
  }

  const parsed = new URL(uri);
  const pathParts = [parsed.hostname, ...parsed.pathname.split("/")].filter(
    (part) => part !== "",
  );

  if (pathParts[0] === "chapter-tree" && pathParts.length === 1) {
    return { type: "chapter-tree" };
  }

  switch (pathParts[0]) {
    case "chapter":
      if (pathParts.length === 2) {
        return {
          chapterId: parsePositiveInteger(pathParts[1], uri),
          type: "chapter",
        };
      }
      if (pathParts[1] !== undefined) {
        const chapterId = parsePositiveInteger(pathParts[1], uri);

        switch (pathParts[2]) {
          case "chunk":
            if (pathParts.length === 4) {
              return {
                chapterId,
                id: parsePositiveInteger(pathParts[3], uri),
                type: "chunk",
              };
            }
            break;
          case "entity":
            if (pathParts.length === 4) {
              return {
                chapterId,
                qid: parseQid(pathParts[3], uri),
                type: "entity",
              };
            }
            break;
          case "source":
            if (pathParts.length === 3 || pathParts.length === 4) {
              const [start, end] = parseSentenceRange(parsed.hash);
              const fragmentId =
                pathParts[3] === undefined
                  ? undefined
                  : parseNonNegativeInteger(pathParts[3], uri);

              return {
                chapterId,
                endSentenceIndex: end,
                ...(fragmentId === undefined ? {} : { fragmentId }),
                startSentenceIndex: start,
                type: "source",
              };
            }
            break;
          case "summary":
            if (pathParts.length === 3) {
              return {
                chapterId,
                endSentenceIndex: Number.POSITIVE_INFINITY,
                startSentenceIndex: 0,
                type: "summary",
              };
            }
            break;
          case "tree":
            if (pathParts.length === 3) {
              return { chapterId, type: "chapter" };
            }
            break;
          case "triple":
            if (pathParts.length === 6) {
              return {
                chapterId,
                objectQid: parseQid(pathParts[5], uri),
                predicate: decodeURIComponent(pathParts[4] ?? ""),
                subjectQid: parseQid(pathParts[3], uri),
                type: "triple",
              };
            }
            break;
        }
      }
      break;
    case "chunk":
      if (pathParts.length === 2) {
        return {
          id: parsePositiveInteger(pathParts[1], uri),
          type: "chunk",
        };
      }
      break;
    case "entity":
      if (pathParts.length === 2) {
        return {
          qid: parseQid(pathParts[1], uri),
          type: "entity",
        };
      }
      break;
    case "triple":
      if (pathParts.length === 4) {
        return {
          objectQid: parseQid(pathParts[3], uri),
          predicate: decodeURIComponent(pathParts[2] ?? ""),
          subjectQid: parseQid(pathParts[1], uri),
          type: "triple",
        };
      }
      break;
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function parseQid(value: string | undefined, uri: string): string {
  if (value !== undefined && /^Q[1-9][0-9]*$/u.test(value)) {
    return value;
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function parseSentenceRange(hash: string): readonly [number, number] {
  if (hash === "") {
    return [0, Number.POSITIVE_INFINITY];
  }

  const [start, end] = hash.slice(1).split("..", 2);
  const parsedStart = Number(start);
  const parsedEnd = Number(end);

  if (
    Number.isInteger(parsedStart) &&
    parsedStart >= 0 &&
    Number.isInteger(parsedEnd) &&
    parsedEnd >= parsedStart
  ) {
    return [parsedStart, parsedEnd];
  }

  throw new Error(`Invalid source sentence range: ${hash}`);
}

function parseArchiveReference(id: string):
  | {
      readonly id: number;
      readonly type: "chapter" | "summary";
    }
  | {
      readonly id: number;
      readonly type: "node";
    }
  | {
      readonly fragmentId: number;
      readonly serialId: number;
      readonly type: "fragment";
    }
  | {
      readonly type: "meta";
    } {
  const normalized = id.trim();
  const [type, value] = normalized.split(":", 2);

  if (type === "meta" && value === "book") {
    return { type: "meta" };
  }
  if (type === "chapter" || type === "summary") {
    const parsedId = parsePositiveInteger(value, normalized);

    return { id: parsedId, type };
  }
  if (type === "node") {
    const parsedId = parsePositiveInteger(value, normalized);

    return {
      id: parsedId,
      type: "node",
    };
  }
  if (type === "fragment") {
    const parts = normalized.slice("fragment:".length).split(":");

    if (parts.length !== 2) {
      throw new Error(`Invalid archive object id: ${id}`);
    }

    return {
      fragmentId: parseNonNegativeInteger(parts[1], normalized),
      serialId: parsePositiveInteger(parts[0], normalized),
      type: "fragment",
    };
  }
  throw new Error(`Invalid archive object id: ${id}`);
}

function parsePositiveInteger(value: string | undefined, id: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid archive object id: ${id}`);
  }

  return parsed;
}

function parseNonNegativeInteger(
  value: string | undefined,
  id: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid archive object id: ${id}`);
  }

  return parsed;
}

interface ArchiveTextSearch {
  readonly match: ArchiveFindMatch;
  readonly terms: readonly string[];
}

interface ArchiveTextMatch {
  readonly matchCount: number;
  readonly matchedTerms: readonly string[];
  readonly missingTerms: readonly string[];
  readonly score: number;
}

const DEFAULT_FIND_LIMIT = 20;
const GROUP_SCORE_EVIDENCE_LIMIT = 10;
const GROUP_SCORE_MAX_EQUAL_EVIDENCE_BONUS = 0.3;
const PAGE_SUMMARY_LIMIT = 1600;

const BROAD_FIND_LENS_HINT = {
  lenses: {
    chapter: "book outline and chapter titles",
    fragment: "original source wording",
    node: "topology / LLM Wiki structure",
    summary: "quick overview",
  },
  message:
    "Choose --type chapter, --type chunk, --type summary, or --type source as a search lens.",
} satisfies ArchiveFindLensHint;

function createPhraseSearch(query: string): ArchiveTextSearch | undefined {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return undefined;
  }

  return {
    match: "all",
    terms: [needle],
  };
}

function matchText(
  value: string,
  search: ArchiveTextSearch,
): ArchiveTextMatch | undefined {
  const lower = value.toLowerCase();
  const matchedTerms = search.terms.filter((term) => lower.includes(term));
  const missingTerms = search.terms.filter((term) => !lower.includes(term));

  if (search.match === "all" && missingTerms.length > 0) {
    return undefined;
  }
  if (search.match === "any" && matchedTerms.length === 0) {
    return undefined;
  }
  const [snippetNeedle] = matchedTerms;

  if (snippetNeedle === undefined) {
    return undefined;
  }

  return {
    matchCount: matchedTerms.length,
    matchedTerms,
    missingTerms,
    score: matchedTerms.length / search.terms.length,
  };
}

function createFindMatchFields(
  match: ArchiveTextMatch,
): Pick<
  ArchiveFindHit,
  "matchCount" | "matchedTerms" | "missingTerms" | "score"
> {
  return {
    matchCount: match.matchCount,
    matchedTerms: match.matchedTerms,
    missingTerms: match.missingTerms,
    score: match.score,
  };
}

function aggregateEvidenceScores(scores: readonly number[]): number {
  const rankedScores = [...scores]
    .filter((score) => score > 0)
    .sort((left, right) => right - left)
    .slice(0, GROUP_SCORE_EVIDENCE_LIMIT);
  const [bestScore] = rankedScores;

  if (bestScore === undefined) {
    return 0;
  }

  const evidenceDecayFactor =
    GROUP_SCORE_MAX_EQUAL_EVIDENCE_BONUS / calculateEvidenceDecayBase();

  return rankedScores.reduce(
    (total, score, index) =>
      total +
      score *
        (index === 0
          ? 1
          : evidenceDecayFactor / Math.log2(index + 2)),
    0,
  );
}

function calculateEvidenceDecayBase(): number {
  let total = 0;

  for (let rank = 2; rank <= GROUP_SCORE_EVIDENCE_LIMIT; rank += 1) {
    total += 1 / Math.log2(rank + 1);
  }

  return total;
}

function compareFindEvidenceHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

  if (scoreComparison !== 0) {
    return scoreComparison;
  }
  if (left.position === undefined) {
    return right.position === undefined ? 0 : 1;
  }
  if (right.position === undefined) {
    return -1;
  }
  return compareArchivePositions(left.position, right.position);
}

function getSnippetNeedle(match: ArchiveTextMatch): string {
  const [needle] = match.matchedTerms;

  if (needle === undefined) {
    throw new Error("Internal error: missing matched search term.");
  }

  return needle;
}

function createFindResult(
  query: string,
  hits: readonly ArchiveFindHit[],
  options: ArchiveFindOptions,
  terms = createSearchTerms(query),
  lens: ArchiveFindLens = options.types === undefined ? "broad" : "typed",
): ArchiveFindResult {
  const ranked = createRankedFindResult(query, hits, options, terms, lens);
  const start = decodeFindCursor(options.cursor);
  const items = ranked.items.slice(start, start + ranked.limit);
  const nextOffset = start + items.length;

  return {
    ...ranked,
    items,
    nextCursor:
      nextOffset < ranked.items.length ? encodeFindCursor(nextOffset) : null,
  };
}

function createRankedFindResult(
  query: string,
  hits: readonly ArchiveFindHit[],
  options: ArchiveFindOptions,
  terms = createSearchTerms(query),
  lens: ArchiveFindLens = options.types === undefined ? "broad" : "typed",
): ArchiveFindResult {
  const order = options.order ?? "doc-asc";
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const chapters = options.chapters ?? null;
  const match = options.match ?? "any";
  const types = options.types ?? null;
  const ids = options.ids ?? null;
  const filtered = groupFindHitsByObject(hits)
    .filter((hit) => matchesFindId(hit, ids))
    .filter((hit) => matchesFindChapter(hit, chapters))
    .filter((hit) => matchesFindType(hit, types))
    .sort((left, right) => compareFindHits(left, right, order));

  return {
    chapters,
    items: filtered,
    lens,
    lensHint: lens === "broad" ? BROAD_FIND_LENS_HINT : null,
    limit,
    match,
    nextCursor: null,
    order,
    query,
    terms,
    types,
  };
}

function groupFindHitsByObject(
  hits: readonly ArchiveFindHit[],
): readonly ArchiveFindHit[] {
  const hitsById = new Map<string, ArchiveFindHit[]>();

  for (const hit of hits) {
    const values = hitsById.get(hit.id) ?? [];

    values.push(hit);
    hitsById.set(hit.id, values);
  }

  return [...hitsById.values()].map(groupObjectEvidenceHits);
}

function groupObjectEvidenceHits(
  evidenceHits: readonly ArchiveFindHit[],
): ArchiveFindHit {
  const rankedHits = [...evidenceHits].sort(compareFindEvidenceHits);
  const [best] = rankedHits;

  if (best === undefined) {
    throw new Error("Internal error: search result candidate is empty.");
  }
  if (rankedHits.length === 1) {
    return best;
  }

  return {
    ...best,
    matchCount: Math.max(...rankedHits.map((hit) => hit.matchCount ?? 0)),
    matchedTerms: mergeStringLists(
      rankedHits.flatMap((hit) => hit.matchedTerms ?? []),
    ),
    missingTerms: mergeStringLists(
      rankedHits.flatMap((hit) => hit.missingTerms ?? []),
    ),
    score: aggregateEvidenceScores(rankedHits.map((hit) => hit.score ?? 0)),
  };
}

function mergeStringLists(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function createCollectionResult(
  hits: readonly ArchiveFindHit[],
  options: ArchiveCollectionOptions,
): ArchiveCollectionResult {
  const order = options.order ?? "doc-asc";
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const chapters = options.chapters ?? null;
  const ids = options.ids ?? null;
  const types = options.types ?? null;
  const start = decodeFindCursor(options.cursor);
  const filtered = hits
    .filter((hit) => matchesFindId(hit, ids))
    .filter((hit) => matchesFindChapter(hit, chapters))
    .filter((hit) => matchesCollectionType(hit, types))
    .sort((left, right) => compareFindHits(left, right, order));
  const items = filtered.slice(start, start + limit);
  const nextOffset = start + items.length;

  return {
    chapters,
    ids,
    items,
    limit,
    nextCursor:
      nextOffset < filtered.length ? encodeFindCursor(nextOffset) : null,
    order,
    types,
  };
}

function matchesFindId(
  hit: ArchiveFindHit,
  ids: readonly string[] | null,
): boolean {
  return ids === null || ids.includes(hit.id);
}

function matchesFindChapter(
  hit: ArchiveFindHit,
  chapters: readonly number[] | null,
): boolean {
  if (chapters === null) {
    return true;
  }

  return hit.chapter !== undefined && chapters.includes(hit.chapter);
}

function matchesFindType(
  hit: ArchiveFindHit,
  types: readonly ArchiveFindFilterType[] | null,
): boolean {
  if (types === null) {
    return true;
  }

  return isFindFilterType(hit.type) && types.includes(hit.type);
}

function matchesCollectionType(
  hit: ArchiveFindHit,
  types: readonly ArchiveCollectionType[] | null,
): boolean {
  return (
    types === null || (isCollectionType(hit.type) && types.includes(hit.type))
  );
}

function compareFindHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  const relevance =
    compareNumbers(right.score ?? 0, left.score ?? 0) ||
    compareNumbers(right.matchCount ?? 0, left.matchCount ?? 0);
  const position =
    compareNumbers(getPositionChapter(left), getPositionChapter(right)) ||
    compareNumbers(getPositionFragment(left), getPositionFragment(right)) ||
    compareNumbers(getTypeOrder(left.type), getTypeOrder(right.type)) ||
    left.id.localeCompare(right.id);

  return relevance || position * direction;
}

function createSearchTerms(query: string): readonly string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

function truncatePageSummary(text: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (text.length <= PAGE_SUMMARY_LIMIT) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, PAGE_SUMMARY_LIMIT - 3)}...`,
    truncated: true,
  };
}

function getPositionChapter(hit: ArchiveFindHit): number {
  return hit.position?.chapter ?? Number.MAX_SAFE_INTEGER;
}

function getPositionFragment(hit: ArchiveFindHit): number {
  return hit.position?.fragment ?? 0;
}

function getTypeOrder(type: ArchiveFindObjectType): number {
  switch (type) {
    case "chapter":
      return 0;
    case "chapter-tree":
      return 1;
    case "entity":
      return 2;
    case "triple":
      return 3;
    case "summary":
      return 4;
    case "node":
      return 5;
    case "fragment":
      return 6;
    case "meta":
      return 7;
  }
}

function createNodePosition(
  sentenceIds: readonly SentenceId[],
): ArchiveFindPosition | undefined {
  const [first] = [...sentenceIds].sort(compareSentenceIds);

  return first === undefined ? undefined : createSentencePosition(first);
}

function createSentencePosition(sentenceId: SentenceId): ArchiveFindPosition {
  return {
    chapter: sentenceId[0],
    fragment: sentenceId[1],
  };
}

function compareSentenceIds(left: SentenceId, right: SentenceId): number {
  return (
    compareNumbers(left[0], right[0]) ||
    compareNumbers(left[1], right[1]) ||
    compareNumbers(left[2], right[2])
  );
}

function compareArchivePositions(
  left: ArchiveFindPosition,
  right: ArchiveFindPosition,
): number {
  return (
    compareNumbers(left.chapter, right.chapter) ||
    compareNumbers(left.fragment ?? 0, right.fragment ?? 0)
  );
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isFindFilterType(
  type: ArchiveFindObjectType,
): type is ArchiveFindFilterType {
  return (
    type === "chapter" ||
    type === "entity" ||
    type === "fragment" ||
    type === "node" ||
    type === "summary" ||
    type === "triple"
  );
}

function isCollectionType(
  type: ArchiveFindObjectType,
): type is ArchiveCollectionType {
  return (
    type === "chapter" ||
    type === "entity" ||
    type === "fragment" ||
    type === "meta" ||
    type === "node" ||
    type === "summary" ||
    type === "triple"
  );
}

function parseFindLens(value: string): ArchiveFindLens {
  if (value === "broad" || value === "exact" || value === "typed") {
    return value;
  }

  throw new Error("Invalid cached search session.");
}

function parseFindMatch(value: string): ArchiveFindMatch {
  if (value === "all" || value === "any") {
    return value;
  }

  throw new Error("Invalid cached search session.");
}

function parseFindTypes(
  values: readonly string[] | null,
): readonly ArchiveFindFilterType[] | null {
  if (values === null) {
    return null;
  }

  return values.map((value) => {
    if (
      value === "entity" ||
      value === "fragment" ||
      value === "node" ||
      value === "summary" ||
      value === "triple"
    ) {
      return value;
    }

    throw new Error("Invalid cached search session.");
  });
}

function encodeFindCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset, v: 1 })).toString("base64url");
}

function decodeFindCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "v" in parsed &&
      "offset" in parsed &&
      parsed.v === 1 &&
      Number.isInteger(parsed.offset) &&
      typeof parsed.offset === "number" &&
      parsed.offset >= 0
    ) {
      return parsed.offset;
    }
  } catch {
    throw new Error("Invalid search cursor.");
  }

  throw new Error("Invalid search cursor.");
}

function createSnippet(value: string, needle?: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (needle === undefined) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const index = collapsed.toLowerCase().indexOf(needle);

  if (index < 0) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(collapsed.length, index + needle.length + 120);
  const prefix = start === 0 ? "" : "...";
  const suffix = end === collapsed.length ? "" : "...";

  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

function formatMetaSummary(meta: BookMeta | undefined): string {
  if (meta === undefined) {
    return "[missing]";
  }

  return [meta.title, meta.authors.join(", "), meta.sourceFormat]
    .filter((value) => value !== null && value !== "")
    .join(" / ");
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(3);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
