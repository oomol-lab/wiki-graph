import type {
  MentionRecord,
  ReadonlyDocument,
} from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";

import {
  ARCHIVE_ROOT_ID,
  createCollectionResult,
  createNodePosition,
  createSnippet,
  formatMetaSummary,
  formatMetaTitle,
  formatWeight,
  isDefined,
} from "./helpers.js";
import {
  formatEdgeId,
  formatNodeId,
  formatTextStreamRangeUri,
} from "./references.js";
import { createTextStreamIndex } from "./text-streams.js";
import type {
  ArchiveCollectionOptions,
  ArchiveCollectionResult,
  ArchiveFindHit,
  ArchiveIndex,
  ArchiveListItem,
  ArchiveListKind,
  ArchiveTextStreamIndex,
  ArchiveTextStreamKind,
} from "./types.js";
import { createChapterState, formatChapterStateSummary } from "./core.js";
import { hydrateFindHitEvidence } from "./evidence.js";
import { hydrateFindHitBacklinks } from "./backlinks.js";
import {
  compareMentions,
  createUnscoredEntityEvidenceMention,
  filterMentionsByChapterSet,
  formatTripleUri,
  listAllMentions,
  selectEntityLabel,
} from "./knowledge.js";

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
            id: chapter.uri,
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
              id: `${chapter.uri}/summary`,
              label: chapter.title ?? `[chapter ${chapter.path}]`,
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
            const title = chapter.title ?? chapter.uri;

            return listTextStreamSentenceCollection(
              await createTextStreamIndex(
                document,
                chapter.chapterId,
                "source",
              ),
              chapter.chapterId,
              chapter.path,
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
      const title = chapter.title ?? `[chapter ${chapter.path}]`;

      if (types.includes("chapter") || types.includes("chapter-title")) {
        items.push({
          chapter: chapter.chapterId,
          field: "title",
          id: `${chapter.uri}/title`,
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

export function listEntityCollection(
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
  chapterPath: string,
  stream: ArchiveTextStreamKind,
  title: string,
  documentOrder?: number,
): readonly ArchiveFindHit[] {
  return index.sentences.map((sentence) => ({
    chapter: chapterId,
    field: stream,
    id: formatTextStreamRangeUri(
      chapterPath,
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
