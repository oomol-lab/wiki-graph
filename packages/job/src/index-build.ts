import type {
  ChapterJobArtifact,
  ChapterJobSnapshot,
  EmbeddingArtifactPayload,
  FtsArtifactPayload,
  JobEmbeddingSegment,
  JobLexicalRow,
  JobSentence,
} from "./contracts.js";
import type { JobEmbeddingProvider } from "./ports.js";
import { createJobSearchTokenPlan } from "./tokenizer.js";

const DENSE_SEGMENT_TARGET_WORDS = 300;
const DENSE_SEGMENT_MAX_WORDS = 420;
const DENSE_SEGMENT_OVERLAP_WORDS = 80;
const DENSE_SEGMENT_MIN_WORDS = 80;

export function buildFtsJobArtifact(
  snapshot: ChapterJobSnapshot<"index-fts">,
): ChapterJobArtifact<"index-fts"> {
  const input = snapshot.payload;
  const payload: FtsArtifactPayload = {
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
          chapterId: snapshot.chapterId,
          objectKind: "source-sentence",
          rowPrefix: "source-sentence",
          sentence,
          sentenceIndex,
        }),
      ),
      ...input.summarySentences.map((sentence, sentenceIndex) =>
        createTextSentenceLexicalRow({
          chapterId: snapshot.chapterId,
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
  return { ...copyEnvelope(snapshot), payload };
}

export async function buildEmbeddingJobArtifact(
  snapshot: ChapterJobSnapshot<
    "index-embedding-source" | "index-embedding-summary"
  >,
  embeddingProvider: JobEmbeddingProvider,
  signal?: AbortSignal,
): Promise<
  ChapterJobArtifact<
    "index-embedding-source" | "index-embedding-summary"
  >
> {
  const segments = createEmbeddingSegments(snapshot.payload.sentences);
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
  const dimensions =
    embeddingProvider.dimensions ?? embeddings[0]?.length ?? 0;
  if (segments.length > 0 && dimensions <= 0) {
    throw new Error("Embedding provider returned no usable vector dimensions.");
  }
  const kind =
    snapshot.kind === "index-embedding-source"
      ? "embedding-source"
      : "embedding-summary";
  const payload: EmbeddingArtifactPayload = {
    kind,
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
  return { ...copyEnvelope(snapshot), payload };
}

function copyEnvelope<K extends ChapterJobSnapshot["kind"]>(
  snapshot: ChapterJobSnapshot<K>,
): Pick<ChapterJobArtifact<K>, "chapterId" | "kind" | "protocol" | "revision"> {
  return {
    chapterId: snapshot.chapterId,
    kind: snapshot.kind,
    protocol: snapshot.protocol,
    revision: snapshot.revision,
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
