import type {
  EmbeddingArtifactPayload,
  EmbeddingSnapshotPayload,
  FtsArtifactPayload,
  FtsSnapshotPayload,
  JobEmbeddingSegment,
  JobLexicalRow,
  JobSentence,
} from "./contracts.js";
import type { JobEmbeddingProvider } from "./ports.js";
import { createJobSearchTokenPlan } from "./tokenizer.js";
import type {
  ChapterJobInputRecord,
  JobLexicalRowRecord,
} from "./file-contracts.js";

const DENSE_SEGMENT_TARGET_WORDS = 300;
const DENSE_SEGMENT_MAX_WORDS = 420;
const DENSE_SEGMENT_OVERLAP_WORDS = 80;
const DENSE_SEGMENT_MIN_WORDS = 80;

export function buildFtsIndexPayload(
  input: FtsSnapshotPayload,
): FtsArtifactPayload {
  return {
    lexicalRows: [
      ...input.chapterTitles.map((chapter) =>
        createObjectLexicalRow({
          objectId: String(chapter.id),
          objectKind: "chapter-title",
          rowId: `chapter-title:${chapter.id}`,
          text: chapter.title,
        }),
      ),
      ...input.sentences.map((sentence, sentenceIndex) =>
        createTextSentenceLexicalRow({
          chapterId: input.chapterId,
          objectKind: "source-sentence",
          rowPrefix: "source-sentence",
          sentence,
          sentenceIndex,
        }),
      ),
      ...input.summarySentences.map((sentence, sentenceIndex) =>
        createTextSentenceLexicalRow({
          chapterId: input.chapterId,
          objectKind: "summary-sentence",
          rowPrefix: "summary-sentence",
          sentence,
          sentenceIndex,
        }),
      ),
      ...input.chunks.flatMap((chunk) => [
        createObjectLexicalRow({
          metadata: { wordsCount: chunk.wordsCount },
          objectId: String(chunk.id),
          objectKind: "chunk-label",
          rowId: `chunk-label:${chunk.id}`,
          text: chunk.label,
        }),
        createObjectLexicalRow({
          metadata: { wordsCount: chunk.wordsCount },
          objectId: String(chunk.id),
          objectKind: "chunk-content",
          rowId: `chunk-content:${chunk.id}`,
          text: chunk.content,
        }),
      ]),
      ...input.mentions.map((mention) =>
        createObjectLexicalRow({
          objectId: mention.qid,
          objectKind: "mention-surface",
          rowId: `mention-surface:${mention.id}`,
          text: mention.surface,
        }),
      ),
    ],
    metadata: { source: "chapter-lexical", version: 1 },
  };
}

export function createFtsRowsForInputRecord(
  record: ChapterJobInputRecord,
): readonly JobLexicalRowRecord[] {
  switch (record.type) {
    case "chapter-title":
      return [
        withLexicalRowType(
          createObjectLexicalRow({
            objectId: String(record.chapterId),
            objectKind: "chapter-title",
            rowId: `chapter-title:${record.chapterId}`,
            text: record.title,
          }),
        ),
      ];
    case "source-sentence":
    case "summary-sentence": {
      const prefix =
        record.type === "source-sentence"
          ? "source-sentence"
          : "summary-sentence";
      return [
        withLexicalRowType(
          createObjectLexicalRow({
            metadata: { wordsCount: record.wordsCount },
            objectId: String(record.sentenceIndex),
            objectKind: prefix,
            rowId: `${prefix}:${record.sentenceIndex}`,
            sentenceIndex: record.sentenceIndex,
            text: record.text,
          }),
        ),
      ];
    }
    case "reading-chunk":
      return [
        withLexicalRowType(
          createObjectLexicalRow({
            metadata: { wordsCount: record.wordsCount },
            objectId: record.id,
            objectKind: "chunk-label",
            rowId: `chunk-label:${record.id}`,
            text: record.label,
          }),
        ),
        withLexicalRowType(
          createObjectLexicalRow({
            metadata: { wordsCount: record.wordsCount },
            objectId: record.id,
            objectKind: "chunk-content",
            rowId: `chunk-content:${record.id}`,
            text: record.content,
          }),
        ),
      ];
    case "mention":
      return [
        withLexicalRowType(
          createObjectLexicalRow({
            objectId: record.qid,
            objectKind: "mention-surface",
            rowId: `mention-surface:${record.id}`,
            text: record.surface,
          }),
        ),
      ];
    default:
      return [];
  }
}

export async function buildEmbeddingIndexPayload(
  input: EmbeddingSnapshotPayload & {
    readonly source: "source" | "summary";
  },
  embeddingProvider: JobEmbeddingProvider,
  signal?: AbortSignal,
): Promise<EmbeddingArtifactPayload> {
  const segments = createEmbeddingSegments(input.sentences);
  const embeddings =
    segments.length === 0
      ? []
      : (
          await embeddingProvider.embedTexts(
            segments.map((segment) => segment.text),
            signal === undefined ? undefined : { signal },
          )
        ).embeddings;
  if (embeddings.length !== segments.length) {
    throw new Error(
      `Embedding provider returned ${embeddings.length} vectors for ${segments.length} segments.`,
    );
  }
  const dimensions = embeddingProvider.dimensions ?? embeddings[0]?.length ?? 0;
  if (segments.length > 0 && dimensions <= 0) {
    throw new Error("Embedding provider returned no usable vector dimensions.");
  }
  return {
    kind: input.source === "source" ? "embedding-source" : "embedding-summary",
    metadata: {
      dimensions,
      ...(embeddingProvider.identity === undefined
        ? {}
        : { identity: embeddingProvider.identity }),
      model: embeddingProvider.model,
      version: 1,
    },
    segments: segments.map((segment, index) => {
      const vector = embeddings[index] ?? [];
      if (vector.length !== dimensions) {
        throw new Error(
          `Embedding provider returned ${vector.length} dimensions; expected ${dimensions}.`,
        );
      }
      return { ...segment, vector };
    }),
  };
}

function createTextSentenceLexicalRow(input: {
  readonly chapterId: number;
  readonly objectKind: "source-sentence" | "summary-sentence";
  readonly rowPrefix: string;
  readonly sentence: JobSentence;
  readonly sentenceIndex: number;
}): JobLexicalRow {
  return createObjectLexicalRow({
    metadata: { wordsCount: input.sentence.wordsCount },
    objectId: `${input.chapterId}:${input.sentenceIndex}`,
    objectKind: input.objectKind,
    rowId: `${input.rowPrefix}:${input.sentenceIndex}`,
    sentenceIndex: input.sentenceIndex,
    text: input.sentence.text,
  });
}

function createObjectLexicalRow(input: {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly objectId: string;
  readonly objectKind: string;
  readonly rowId: string;
  readonly sentenceIndex?: number;
  readonly text: string;
}): JobLexicalRow {
  const plan = createJobSearchTokenPlan(input.text);
  const tiers = {
    tier1: plan.tier1.map((token) => token.encoded),
    tier2: plan.tier2.map((token) => token.encoded),
    tier3: plan.tier3.map((token) => token.encoded),
  };
  return {
    metadata: { ...(input.metadata ?? {}), tiers },
    objectId: input.objectId,
    objectKind: input.objectKind,
    rowId: input.rowId,
    ...(input.sentenceIndex === undefined
      ? {}
      : { sentenceIndex: input.sentenceIndex }),
    text: input.text,
    tokens: [...tiers.tier1, ...tiers.tier2, ...tiers.tier3],
  };
}

function withLexicalRowType(row: JobLexicalRow): JobLexicalRowRecord {
  return { ...row, type: "lexical-row" };
}

function createEmbeddingSegments(
  sentences: readonly JobSentence[],
): readonly Omit<JobEmbeddingSegment, "vector">[] {
  const records = sentences
    .map((sentence, sentenceIndex) => ({
      sentenceIndex,
      text: sentence.text,
      wordsCount: requireNonNegativeWordsCount(sentence.wordsCount),
    }))
    .filter((record) => record.text.trim() !== "");
  const segments: Omit<JobEmbeddingSegment, "vector">[] = [];
  let start = 0;
  while (start < records.length) {
    let end = start;
    let wordsCount = 0;
    while (end < records.length) {
      const nextWords = records[end]!.wordsCount;
      if (
        end > start &&
        wordsCount >= DENSE_SEGMENT_MIN_WORDS &&
        wordsCount + nextWords > DENSE_SEGMENT_MAX_WORDS
      ) {
        break;
      }
      wordsCount += nextWords;
      end += 1;
      if (wordsCount >= DENSE_SEGMENT_TARGET_WORDS) break;
    }
    const segment = createEmbeddingSegment(
      records.slice(start, end),
      segments.length,
    );
    if (segment.wordsCount < DENSE_SEGMENT_MIN_WORDS && segments.length > 0) {
      const previous = segments.pop()!;
      const merged = records.filter(
        (record) =>
          record.sentenceIndex >= previous.startSentenceIndex &&
          record.sentenceIndex <= segment.endSentenceIndex,
      );
      segments.push(createEmbeddingSegment(merged, segments.length));
      break;
    }
    segments.push(segment);
    if (end >= records.length) break;
    const nextStart = findSegmentOverlapStart(records, start, end);
    start = nextStart <= start ? end : nextStart;
  }
  return segments.map((segment, segmentIndex) => ({
    ...segment,
    segmentIndex,
  }));
}

export async function* streamEmbeddingSegments(
  sentences: AsyncIterable<{
    readonly sentenceIndex: number;
    readonly text: string;
    readonly wordsCount: number;
  }>,
): AsyncIterable<Omit<JobEmbeddingSegment, "vector">> {
  type Sentence = {
    readonly sentenceIndex: number;
    readonly text: string;
    readonly wordsCount: number;
  };
  let current: Sentence[] = [];
  let currentWords = 0;
  let pending: Sentence[] | undefined;
  let segmentIndex = 0;

  for await (const input of sentences) {
    if (input.text.trim() === "") continue;
    const sentence = {
      ...input,
      wordsCount: requireNonNegativeWordsCount(input.wordsCount),
    };
    if (
      current.length > 0 &&
      (currentWords >= DENSE_SEGMENT_TARGET_WORDS ||
        (currentWords >= DENSE_SEGMENT_MIN_WORDS &&
          currentWords + sentence.wordsCount > DENSE_SEGMENT_MAX_WORDS))
    ) {
      if (pending !== undefined) {
        yield createEmbeddingSegment(pending, segmentIndex);
        segmentIndex += 1;
      }
      pending = current;
      current = overlapRecords(current);
      currentWords = countWords(current);
    }
    current.push(sentence);
    currentWords += sentence.wordsCount;
  }

  if (current.length === 0) {
    if (pending !== undefined)
      yield createEmbeddingSegment(pending, segmentIndex);
    return;
  }
  if (pending !== undefined && currentWords < DENSE_SEGMENT_MIN_WORDS) {
    yield createEmbeddingSegment(
      mergeSentenceRecords(pending, current),
      segmentIndex,
    );
    return;
  }
  if (pending !== undefined) {
    yield createEmbeddingSegment(pending, segmentIndex);
    segmentIndex += 1;
  }
  yield createEmbeddingSegment(current, segmentIndex);
}

function overlapRecords<T extends { readonly wordsCount: number }>(
  records: readonly T[],
): T[] {
  const start = findSegmentOverlapStart(records, 0, records.length);
  return records.slice(start);
}

function countWords(
  records: readonly { readonly wordsCount: number }[],
): number {
  return records.reduce((sum, record) => sum + record.wordsCount, 0);
}

function mergeSentenceRecords<T extends { readonly sentenceIndex: number }>(
  left: readonly T[],
  right: readonly T[],
): T[] {
  return [
    ...new Map(
      [...left, ...right].map((record) => [record.sentenceIndex, record]),
    ).values(),
  ].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
}

function requireNonNegativeWordsCount(wordsCount: number): number {
  if (!Number.isFinite(wordsCount) || wordsCount < 0) {
    throw new Error("Sentence word count must be non-negative.");
  }
  return wordsCount;
}

function createEmbeddingSegment(
  records: readonly {
    readonly sentenceIndex: number;
    readonly text: string;
    readonly wordsCount: number;
  }[],
  segmentIndex: number,
): Omit<JobEmbeddingSegment, "vector"> {
  const first = records[0];
  const last = records.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot create an empty embedding segment.");
  }
  return {
    endSentenceIndex: last.sentenceIndex,
    segmentIndex,
    startSentenceIndex: first.sentenceIndex,
    text: records.map((record) => record.text).join("\n"),
    wordsCount: records.reduce((sum, record) => sum + record.wordsCount, 0),
  };
}

function findSegmentOverlapStart(
  records: readonly { readonly wordsCount: number }[],
  start: number,
  end: number,
): number {
  let wordsCount = 0;
  for (let index = end - 1; index > start; index -= 1) {
    wordsCount += records[index]!.wordsCount;
    if (wordsCount >= DENSE_SEGMENT_OVERLAP_WORDS) return index;
  }
  return end;
}
