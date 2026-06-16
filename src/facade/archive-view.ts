import type {
  Document,
  KnowledgeEdgeRecord,
  SentenceId,
} from "../document/index.js";
import type { BookMeta } from "../source/index.js";

import {
  getGraphNode,
  listGraphNeighbors,
  type GraphEvidenceLine,
  type GraphNeighbor,
  type GraphNode,
} from "./graph.js";
import { listChapters, type ChapterEntry } from "./chapter.js";

export type ArchiveObjectType =
  | "chapter"
  | "edge"
  | "evidence"
  | "meta"
  | "node"
  | "summary";

export interface ArchiveIndex {
  readonly chapters: readonly ChapterEntry[];
  readonly edgeCount: number;
  readonly meta: BookMeta | undefined;
  readonly nodeCount: number;
  readonly summaryCount: number;
}

export interface ArchiveFindHit {
  readonly field: ArchiveFindField;
  readonly id: string;
  readonly snippet: string;
  readonly title: string;
  readonly type: ArchiveObjectType;
}

export type ArchiveFindField =
  | "content"
  | "evidence"
  | "metadata"
  | "summary"
  | "title";

export type ArchiveListKind =
  | "chapters"
  | "edges"
  | "evidence"
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
      readonly content: string | undefined;
      readonly id: string;
      readonly title: string;
      readonly type: "chapter";
    }
  | {
      readonly evidence: readonly GraphEvidenceLine[];
      readonly id: string;
      readonly neighbors: readonly GraphNeighbor[];
      readonly node: GraphNode;
      readonly title: string;
      readonly type: "node";
    }
  | {
      readonly id: string;
      readonly sentenceId: SentenceId;
      readonly text: string;
      readonly title: string;
      readonly type: "evidence";
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
    case "evidence":
      return await listEvidenceObjects(document);
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
  }
}

export async function findArchiveObjects(
  document: Document,
  query: string,
): Promise<readonly ArchiveFindHit[]> {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return [];
  }

  const hits: ArchiveFindHit[] = [];

  hits.push(...findMeta(await document.readBookMeta(), needle));
  hits.push(...(await findChapters(document, needle)));
  hits.push(...(await findNodes(document, needle)));

  return hits;
}

export async function readArchivePage(
  document: Document,
  id: string,
): Promise<ArchivePage> {
  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter": {
      const chapter = await requireChapter(document, reference.id);

      return {
        chapter,
        content: await document.readSummary(reference.id),
        id: formatChapterId(reference.id),
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "chapter",
      };
    }
    case "evidence": {
      const text = await document.getSentence(reference.sentenceId);

      return {
        id: formatSentenceId(reference.sentenceId),
        sentenceId: reference.sentenceId,
        text,
        title: formatSentenceId(reference.sentenceId),
        type: "evidence",
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
      const [neighbors, evidence] = await Promise.all([
        listGraphNeighbors(document, chapterId, reference.id),
        readNodeEvidence(document, node),
      ]);

      return {
        evidence,
        id: formatNodeId(node.id),
        neighbors,
        node,
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

export async function readArchiveEvidence(
  document: Document,
  id: string,
): Promise<readonly GraphEvidenceLine[]> {
  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "node":
      return await readNodeEvidence(
        document,
        (await requireNode(document, reference.id)).node,
      );
    case "evidence":
      return [
        {
          sentenceId: reference.sentenceId,
          text: await document.getSentence(reference.sentenceId),
        },
      ];
    case "chapter":
    case "meta":
    case "summary":
      return [];
  }
}

export async function listArchiveLinks(
  document: Document,
  id: string,
  direction: "backlinks" | "links",
): Promise<readonly GraphNeighbor[]> {
  const reference = parseArchiveReference(id);

  if (reference.type !== "node") {
    return [];
  }

  const { chapterId } = await requireNode(document, reference.id);
  const neighbors = await listGraphNeighbors(document, chapterId, reference.id);

  return neighbors.filter((neighbor) =>
    direction === "links"
      ? neighbor.direction === "outgoing"
      : neighbor.direction === "incoming",
  );
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

export function formatSentenceId(sentenceId: SentenceId): string {
  return `sentence:${sentenceId.join(":")}`;
}

export function formatSummaryId(chapterId: number): string {
  return `summary:${chapterId}`;
}

async function listEvidenceObjects(
  document: Document,
): Promise<readonly ArchiveListItem[]> {
  const nodes = await document.chunks.listAll();
  const items: ArchiveListItem[] = [];

  for (const node of nodes) {
    for (const sentenceId of node.sentenceIds) {
      items.push({
        id: formatSentenceId(sentenceId),
        label: formatSentenceId(sentenceId),
        summary: await document.getSentence(sentenceId),
        type: "evidence",
      });
    }
  }

  return items;
}

async function findChapters(
  document: Document,
  needle: string,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const chapter of await listChapters(document)) {
    const title = chapter.title ?? `[chapter ${chapter.chapterId}]`;

    if (matches(title, needle)) {
      hits.push({
        field: "title",
        id: formatChapterId(chapter.chapterId),
        snippet: title,
        title,
        type: "chapter",
      });
    }

    const summary = await document.readSummary(chapter.chapterId);

    if (summary !== undefined && matches(summary, needle)) {
      hits.push({
        field: "summary",
        id: formatSummaryId(chapter.chapterId),
        snippet: createSnippet(summary, needle),
        title,
        type: "summary",
      });
    }
  }

  return hits;
}

function findMeta(
  meta: BookMeta | undefined,
  needle: string,
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

  if (!matches(content, needle)) {
    return [];
  }

  return [
    {
      field: "metadata",
      id: "meta:book",
      snippet: createSnippet(content, needle),
      title: meta.title ?? "Book metadata",
      type: "meta",
    },
  ];
}

async function findNodes(
  document: Document,
  needle: string,
): Promise<readonly ArchiveFindHit[]> {
  const hits: ArchiveFindHit[] = [];

  for (const node of await document.chunks.listAll()) {
    if (matches(node.label, needle)) {
      hits.push({
        field: "title",
        id: formatNodeId(node.id),
        snippet: node.label,
        title: node.label,
        type: "node",
      });
    }
    if (matches(node.content, needle)) {
      hits.push({
        field: "content",
        id: formatNodeId(node.id),
        snippet: createSnippet(node.content, needle),
        title: node.label,
        type: "node",
      });
    }

    for (const sentenceId of node.sentenceIds) {
      const text = await document.getSentence(sentenceId);

      if (matches(text, needle)) {
        hits.push({
          field: "evidence",
          id: formatSentenceId(sentenceId),
          snippet: createSnippet(text, needle),
          title: node.label,
          type: "evidence",
        });
      }
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

async function readNodeEvidence(
  document: Document,
  node: GraphNode,
): Promise<readonly GraphEvidenceLine[]> {
  return await Promise.all(
    node.sentenceIds.map(async (sentenceId) => ({
      sentenceId,
      text: await document.getSentence(sentenceId),
    })),
  );
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
      readonly sentenceId: SentenceId;
      readonly type: "evidence";
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
  if (type === "sentence") {
    const parts = normalized.slice("sentence:".length).split(":");

    if (parts.length !== 3) {
      throw new Error(`Invalid archive object id: ${id}`);
    }

    return {
      sentenceId: [
        parsePositiveInteger(parts[0], normalized),
        parseNonNegativeInteger(parts[1], normalized),
        parseNonNegativeInteger(parts[2], normalized),
      ],
      type: "evidence",
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

function matches(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle);
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
