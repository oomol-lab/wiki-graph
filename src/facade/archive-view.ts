import type {
  ChunkRecord,
  Document,
  KnowledgeEdgeRecord,
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
import { listChapters, type ChapterEntry } from "./chapter.js";

export type ArchiveObjectType =
  | "chapter"
  | "edge"
  | "fragment"
  | "meta"
  | "node"
  | "summary";

export type ArchiveCollectionType =
  | "chapter"
  | "fragment"
  | "meta"
  | "node"
  | "summary";

export type ArchiveFindObjectType =
  | "chapter"
  | "fragment"
  | "meta"
  | "node"
  | "summary";

export type ArchiveFindFilterType = "fragment" | "node" | "summary";

export interface ArchiveIndex {
  readonly chapters: readonly ChapterEntry[];
  readonly edgeCount: number;
  readonly meta: BookMeta | undefined;
  readonly nodeCount: number;
  readonly summaryCount: number;
}

export interface ArchiveFindHit {
  readonly chapter?: number;
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

export type ArchiveFindField =
  | "content"
  | "metadata"
  | "source"
  | "summary"
  | "title";

export interface ArchiveFindOptions {
  readonly chapters?: readonly number[];
  readonly cursor?: string;
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

export interface ArchiveListItem {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly type: ArchiveObjectType;
}

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

export async function getArchiveIndex(
  document: Document,
): Promise<ArchiveIndex> {
  const [chapters, meta, nodes, edges] = await Promise.all([
    listChapters(document),
    document.readBookMeta(),
    document.chunks.listAll(),
    document.knowledgeEdges.listAll(),
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
  document: Document,
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
      return (await document.knowledgeEdges.listAll()).map((edge) => ({
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
  document: Document,
  options: ArchiveCollectionOptions = {},
): Promise<ArchiveCollectionResult> {
  const items: ArchiveFindHit[] = [];
  const types = options.types ?? [
    "chapter",
    "node",
    "summary",
    "fragment",
    "meta",
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
    for (const chapter of await listChapters(document)) {
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
    for (const chapter of await listChapters(document)) {
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

  return createCollectionResult(items, options);
}

export async function findArchiveObjects(
  document: Document,
  query: string,
  options: ArchiveFindOptions = {},
): Promise<ArchiveFindResult> {
  const search = createKeywordSearch(query, options.match ?? "any");

  if (search === undefined) {
    return createFindResult(query, [], options);
  }

  const hits: ArchiveFindHit[] = [];

  hits.push(...findMeta(await document.readBookMeta(), search));
  hits.push(...(await findChapters(document, search)));
  hits.push(...(await findNodes(document, search)));

  return createFindResult(query, hits, options);
}

export async function grepArchiveObjects(
  document: Document,
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

export async function readArchiveText(
  document: Document,
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
  document: Document,
  id: string,
): Promise<ArchivePage> {
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

export async function listArchiveLinks(
  document: Document,
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
  document: Document,
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
  document: Document,
  id: string,
): Promise<readonly ArchiveListItem[]> {
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

export async function packArchiveContext(
  document: Document,
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
  document: Document,
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
        ? "Do not run a full build in an interactive agent session; build a scoped chapter first."
        : "Estimate is low enough for an interactive build if the user expects LLM-backed work.",
    risk,
    sourceWords: words,
    targetStage,
  };
}

export function formatChapterId(chapterId: number): string {
  return `chapter:${chapterId}`;
}

export function formatEdgeId(edge: KnowledgeEdgeRecord): string {
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

async function findChapters(
  document: Document,
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
  document: Document,
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
  document: Document,
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

async function listChapterNodeGroups(
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
  document: Document,
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
const PAGE_SUMMARY_LIMIT = 1600;

const BROAD_FIND_LENS_HINT = {
  lenses: {
    fragment: "original source wording",
    node: "topology / LLM Wiki structure",
    summary: "quick overview",
  },
  message:
    "Choose --type node, --type summary, or --type fragment as a search lens.",
} satisfies ArchiveFindLensHint;

function createKeywordSearch(
  query: string,
  match: ArchiveFindMatch,
): ArchiveTextSearch | undefined {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");

  if (terms.length === 0) {
    return undefined;
  }

  return {
    match,
    terms,
  };
}

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
  const order = options.order ?? "doc-asc";
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const chapters = options.chapters ?? null;
  const match = options.match ?? "any";
  const types = options.types ?? null;
  const ids = options.ids ?? null;
  const start = decodeFindCursor(options.cursor);
  const filtered = hits
    .filter((hit) => matchesFindId(hit, ids))
    .filter((hit) => matchesFindChapter(hit, chapters))
    .filter((hit) => matchesFindType(hit, types))
    .sort((left, right) => compareFindHits(left, right, order));
  const items = filtered.slice(start, start + limit);
  const nextOffset = start + items.length;

  return {
    chapters,
    items,
    lens,
    lensHint: lens === "broad" ? BROAD_FIND_LENS_HINT : null,
    limit,
    match,
    nextCursor:
      nextOffset < filtered.length ? encodeFindCursor(nextOffset) : null,
    order,
    query,
    terms,
    types,
  };
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
  return types === null || types.includes(hit.type);
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
    case "summary":
      return 1;
    case "node":
      return 2;
    case "fragment":
      return 3;
    case "meta":
      return 4;
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
  return type === "fragment" || type === "node" || type === "summary";
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
