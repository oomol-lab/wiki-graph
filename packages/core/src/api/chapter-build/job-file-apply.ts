import {
  readChapterJobArtifact,
  type ChapterJobArtifactRecord,
  type ChapterJobKind,
  type JobFile,
} from "wiki-graph-job";

import type {
  Document,
  IndexArtifactEmbeddingSegment,
  IndexArtifactLexicalRow,
} from "../../document/index.js";
import {
  expectChunkImportance,
  expectChunkRetention,
} from "../../document/index.js";
import { requireStage } from "../../document/chapter/index.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import { commitChapterSummaryArtifact } from "../../text/summary-build/index.js";

export async function applyChapterJobArtifactFile(
  document: Document,
  chapterId: number,
  kind: ChapterJobKind,
  revision: number,
  artifactFile: JobFile,
): Promise<void> {
  const currentRevision = await document.serials.getRevision(chapterId);
  if (currentRevision !== revision) {
    throw new Error(
      `Chapter ${chapterId} changed from revision ${revision} to ${currentRevision}.`,
    );
  }

  switch (kind) {
    case "index-fts":
      await document.indexArtifacts.replaceFts({
        lexicalRows: readLexicalRows(artifactFile),
        metadata: { source: "chapter-lexical", version: 1 },
        serialId: chapterId,
        sourceRevision: revision,
      });
      return;
    case "index-embedding-source":
    case "index-embedding-summary": {
      const metadata = await readEmbeddingMetadata(artifactFile);
      await document.indexArtifacts.replaceEmbedding({
        kind:
          kind === "index-embedding-source"
            ? "embedding-source"
            : "embedding-summary",
        metadata: {
          dimensions: metadata.dimensions,
          ...(metadata.identity === undefined
            ? {}
            : { identity: metadata.identity }),
          model: metadata.model,
          version: metadata.version,
        },
        segments: readEmbeddingSegments(artifactFile),
        serialId: chapterId,
        sourceRevision: revision,
      });
      return;
    }
    case "reading-graph":
      await applyReadingGraph(document, chapterId, artifactFile);
      return;
    case "reading-summary":
      await applyReadingSummary(document, chapterId, artifactFile);
      return;
    case "knowledge-graph":
      await applyKnowledgeGraph(document, chapterId, artifactFile);
      return;
  }
}

async function applyReadingGraph(
  document: Document,
  chapterId: number,
  file: JobFile,
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await requireStage(openedDocument, chapterId, "sourced");
    const hadFtsArtifact =
      (await openedDocument.indexArtifacts.get(chapterId, "fts")) !== undefined;
    await openedDocument.clearSerialReadingGraph(chapterId);
    await openedDocument.serials.ensure(chapterId);

    const chunkIds = new Map<string, number>();
    const snakeIds = new Map<string, number>();
    let parameter:
      | { readonly language?: string; readonly prompt: string }
      | undefined;

    for await (const record of readChapterJobArtifact(file)) {
      switch (record.type) {
        case "job-parameter":
          if (record.scope === "reading-graph") {
            parameter = {
              ...(record.language === undefined
                ? {}
                : { language: record.language }),
              prompt: record.prompt,
            };
          }
          break;
        case "reading-chunk": {
          const chunk = await openedDocument.chunks.create({
            content: record.content,
            generation: record.generation,
            ...(record.importance === undefined
              ? {}
              : { importance: expectChunkImportance(record.importance) }),
            label: record.label,
            ...(record.retention === undefined
              ? {}
              : { retention: expectChunkRetention(record.retention) }),
            sentenceId: [chapterId, record.sentenceIndex],
            sentenceIds: record.sentenceIndexes.map(
              (sentenceIndex) => [chapterId, sentenceIndex] as const,
            ),
            weight: record.weight,
            wordsCount: record.wordsCount,
          });
          chunkIds.set(record.id, chunk.id);
          break;
        }
        case "reading-edge":
          await openedDocument.readingEdges.save({
            fromId: requireMappedId(chunkIds, record.fromChunkId, "chunk"),
            ...(record.strength === undefined
              ? {}
              : { strength: record.strength }),
            toId: requireMappedId(chunkIds, record.toChunkId, "chunk"),
            weight: record.weight,
          });
          break;
        case "fragment-group":
          await openedDocument.fragmentGroups.saveMany([
            {
              endSentenceIndex: record.endSentenceIndex,
              groupId: record.groupId,
              serialId: chapterId,
              startSentenceIndex: record.startSentenceIndex,
            },
          ]);
          break;
        case "snake": {
          const snakeId = await openedDocument.snakes.create({
            firstLabel: record.firstLabel,
            groupId: record.groupId,
            lastLabel: record.lastLabel,
            localSnakeId: record.localSnakeId,
            serialId: chapterId,
            size: record.size,
            weight: record.weight,
            wordsCount: record.wordsCount,
          });
          snakeIds.set(record.id, snakeId);
          break;
        }
        case "snake-chunk":
          await openedDocument.snakeChunks.save({
            chunkId: requireMappedId(chunkIds, record.chunkId, "chunk"),
            position: record.position,
            snakeId: requireMappedId(snakeIds, record.snakeId, "snake"),
          });
          break;
        case "snake-edge":
          await openedDocument.snakeEdges.save({
            fromSnakeId: requireMappedId(
              snakeIds,
              record.fromSnakeId,
              "snake",
            ),
            toSnakeId: requireMappedId(snakeIds, record.toSnakeId, "snake"),
            weight: record.weight,
          });
          break;
        default:
          break;
      }
    }

    if (parameter === undefined) {
      throw new Error("Reading Graph artifact is missing its job parameter.");
    }
    const savedParameter =
      await openedDocument.graphBuildParameters.save(parameter);
    await openedDocument.serials.setTopologyReady(
      chapterId,
      true,
      savedParameter.hash,
    );
    if (hadFtsArtifact) {
      await replaceChapterFtsIndexArtifact(openedDocument, chapterId);
    }
  });
}

async function applyReadingSummary(
  document: Document,
  chapterId: number,
  file: JobFile,
): Promise<void> {
  const parts: Array<{ readonly position: number; readonly text: string }> = [];
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type === "summary-part") parts.push(record);
  }
  parts.sort((left, right) => left.position - right.position);
  await commitChapterSummaryArtifact(
    document,
    chapterId,
    parts.map((part) => part.text).join("\n\n"),
  );
}

async function applyKnowledgeGraph(
  document: Document,
  chapterId: number,
  file: JobFile,
): Promise<void> {
  let linkCount = 0;
  let parameter:
    | { readonly language?: string; readonly prompt: string }
    | undefined;
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type === "mention-link") linkCount += 1;
    if (record.type === "job-parameter" && record.scope === "knowledge-graph") {
      parameter = {
        ...(record.language === undefined ? {} : { language: record.language }),
        prompt: record.prompt,
      };
    }
  }
  if (parameter === undefined) {
    throw new Error("Knowledge Graph artifact is missing its job parameter.");
  }

  await document.openSession(async (openedDocument) => {
    await openedDocument.serials.ensure(chapterId);
    const existingLinks = await openedDocument.mentionLinks.listByChapter(
      chapterId,
    );
    if (existingLinks.length > 0 && linkCount === 0) {
      throw new Error(
        `Refusing to replace chapter ${chapterId} knowledge graph with an artifact that contains no mention links.`,
      );
    }
    const hadFtsArtifact =
      (await openedDocument.indexArtifacts.get(chapterId, "fts")) !== undefined;
    await openedDocument.clearSerialKnowledgeGraph(chapterId);

    for await (const record of readChapterJobArtifact(file)) {
      if (record.type === "mention") {
        await openedDocument.mentions.save({
          chapterId,
          ...(record.confidence === undefined
            ? {}
            : { confidence: record.confidence }),
          ...(record.fragmentId === undefined
            ? {}
            : { fragmentId: record.fragmentId }),
          id: record.id,
          ...(record.note === undefined ? {} : { note: record.note }),
          qid: record.qid,
          rangeEnd: record.rangeEnd,
          rangeStart: record.rangeStart,
          ...(record.sentenceIndex === undefined
            ? {}
            : { sentenceIndex: record.sentenceIndex }),
          surface: record.surface,
        });
      } else if (record.type === "mention-link") {
        await openedDocument.mentionLinks.save({
          ...(record.confidence === undefined
            ? {}
            : { confidence: record.confidence }),
          evidenceSentenceIds: record.evidenceSentenceIndexes.map(
            (sentenceIndex) => [chapterId, sentenceIndex] as const,
          ),
          id: record.id,
          ...(record.note === undefined ? {} : { note: record.note }),
          predicate: record.predicate,
          sourceMentionId: record.sourceMentionId,
          targetMentionId: record.targetMentionId,
        });
      }
    }

    const savedParameter =
      await openedDocument.graphBuildParameters.save(parameter);
    await openedDocument.serials.setKnowledgeGraphReady(
      chapterId,
      true,
      savedParameter.hash,
    );
    if (hadFtsArtifact) {
      await replaceChapterFtsIndexArtifact(openedDocument, chapterId);
    }
  });
}

function requireMappedId(
  ids: ReadonlyMap<string, number>,
  id: string,
  kind: string,
): number {
  const mapped = ids.get(id);
  if (mapped === undefined) throw new Error(`Unknown ${kind} id ${id}.`);
  return mapped;
}

async function* readLexicalRows(
  file: JobFile,
): AsyncIterable<IndexArtifactLexicalRow> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type !== "lexical-row") continue;
    const { type: _, ...row } = record;
    yield row;
  }
}

async function* readEmbeddingSegments(
  file: JobFile,
): AsyncIterable<IndexArtifactEmbeddingSegment> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type !== "embedding-segment") continue;
    const { type: _, ...segment } = record;
    yield segment;
  }
}

async function readEmbeddingMetadata(file: JobFile): Promise<
  Extract<ChapterJobArtifactRecord, { readonly type: "embedding-metadata" }>
> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type === "embedding-metadata") return record;
  }
  throw new Error("Embedding artifact is missing its metadata record.");
}
