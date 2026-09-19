import type { ChunkRecord, ReadonlyDocument } from "../../../document/index.js";
import {
  listChapters,
  type ChapterEntry,
} from "../../../document/chapter/index.js";
import { getGraphNode, type GraphNode } from "../../../graph/reading.js";

import { compareArchivePositions, createNodePosition } from "./helpers.js";
import {
  formatChapterId,
  formatNodeId,
  formatTextStreamRangeUri,
} from "./references.js";
import { createTextStreamIndex, readSourceFragment } from "./text-streams.js";
import type {
  ArchiveNodeLabel,
  ArchiveNodeSourceFragment,
  ArchiveTextStreamIndex,
  ChapterState,
  PositionedNodeLabel,
} from "./types.js";

export const DEFAULT_SOURCE_CONTEXT = 2;

export async function requireChapter(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterEntry> {
  const chapter = (await listChapters(document)).find(
    (entry: any) => entry.chapterId === chapterId,
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

export function formatChapterStateSummary(state: ChapterState): string {
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
  const chapters = new Map(
    (await listChapters(document)).map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
  );

  return await Promise.all(
    fragmentIds.map(async ([chapterId, fragmentId, fragmentEnd]) => {
      const fragment = await readSourceFragment(
        document,
        chapterId,
        fragmentId,
      );
      const text = truncateSourceExcerpt(fragment.text);
      const chapter = chapters.get(chapterId);

      return {
        id:
          chapter === undefined
            ? fragment.id
            : formatTextStreamRangeUri(
                chapter.path,
                "source",
                fragmentId,
                fragmentEnd,
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
): Promise<readonly (readonly [number, number, number])[]> {
  const seen = new Set<string>();
  const fragmentIds: (readonly [number, number, number])[] = [];
  const indexes = new Map<number, Promise<ArchiveTextStreamIndex>>();

  for (const [chapterId, sentenceIndex] of node.sentenceIds) {
    const serial = document.getSerialFragments(chapterId);
    const direct = await serial.getFragmentRangeForSentence?.(sentenceIndex);
    if (direct !== undefined) {
      const key = `${chapterId}:${direct.startSentenceIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        fragmentIds.push([
          chapterId,
          direct.startSentenceIndex,
          direct.endSentenceIndex,
        ]);
      }
      continue;
    }
    let index = indexes.get(chapterId);
    if (index === undefined) {
      index = createTextStreamIndex(document, chapterId, "source");
      indexes.set(chapterId, index);
    }
    const sentence = (await index).sentences[sentenceIndex];
    if (sentence === undefined) continue;
    const key = `${chapterId}:${sentence.fragmentId}`;
    if (!seen.has(key)) {
      seen.add(key);
      const fragmentSentences = (await index).sentences.filter(
        (candidate) => candidate.fragmentId === sentence.fragmentId,
      );
      fragmentIds.push([
        chapterId,
        sentence.fragmentId,
        fragmentSentences.at(-1)?.globalIndex ?? sentence.globalIndex,
      ]);
    }
  }
  return fragmentIds;
}

function truncateSourceExcerpt(text: string): string {
  return text.length <= 1200 ? text : `${text.slice(0, 1200)}...`;
}

export function createNodeEvidenceRanges(
  node: Pick<GraphNode, "sentenceIds">,
): Array<{
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
