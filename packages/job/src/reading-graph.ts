import type {
  ChapterJobArtifactRecord,
  JobOptionsRecord,
  JobSourceTextRecord,
} from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import type { JobFile } from "./platform.js";
import type { JobLlm, JobProgressSink } from "./ports.js";
import { JOB_LLM_SCOPES } from "./sampling.js";
import { Reader, type ReaderChunk } from "./reading/index.js";
import { createReadingLlm } from "./reading/llm.js";
import type {
  FragmentRecord,
  ReadonlySerialFragments,
} from "./reading/model.js";
import { Topology } from "./reading/topology/core.js";

const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";
const DEFAULT_FRAGMENT_WORDS_COUNT = 320;
const DEFAULT_GENERATION_DECAY_FACTOR = 0.5;
const DEFAULT_GROUP_WORDS_COUNT = 3840;
const DEFAULT_WORKING_MEMORY_CAPACITY = 7;

export async function* buildReadingGraphRecords(options: {
  readonly inputFile: JobFile;
  readonly language?: string;
  readonly llm: JobLlm;
  readonly prompt?: string;
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const input = await readInput(options.inputFile);
  const language = options.language ?? input.jobOptions.language;
  const extractionPrompt = resolveExtractionPrompt(
    options.prompt ?? input.jobOptions.prompt,
  );
  yield {
    ...(language === undefined ? {} : { language }),
    prompt: extractionPrompt,
    scope: "reading-graph",
    type: "job-parameter",
  };

  let nextChunkId = 1;
  const reader = new Reader({
    attention: {
      capacity: DEFAULT_WORKING_MEMORY_CAPACITY,
      generationDecayFactor: DEFAULT_GENERATION_DECAY_FACTOR,
      idGenerator: () => Promise.resolve(nextChunkId++),
    },
    extractionGuidance: extractionPrompt,
    llm: createReadingLlm(options),
    scopes: {
      choice: JOB_LLM_SCOPES.readingGraphEvidenceChoice,
      extraction: JOB_LLM_SCOPES.readingGraphExtraction,
    },
    sentenceTextSource: input.fragments,
    ...(language === undefined ? {} : { userLanguage: language }),
  });
  const topology = new Topology(input.fragments, 0, DEFAULT_GROUP_WORDS_COUNT);
  const allChunks: ReaderChunk[] = [];
  const successorIdsByChunkId: Record<string, number[] | undefined> =
    Object.create(null) as Record<string, number[] | undefined>;
  const processingFragments = createProcessingFragments(input.sentences);
  const totalSentences = processingFragments.reduce(
    (total, fragment) => total + fragment.sentences.length,
    0,
  );
  let completedSentences = 0;

  await options.progress?.updatePhase?.({
    done: 0,
    phase: "reading-extraction",
    total: totalSentences,
    unit: "sentence",
  });
  for (const fragment of processingFragments) {
    await options.progress?.throwIfStopped?.();
    const sentences = fragment.sentences.map((sentence) => ({
      sentenceId: [0, sentence.sentenceIndex] as const,
      text: sentence.text,
      wordsCount: sentence.wordsCount,
    }));
    const text = sentences.map((sentence) => sentence.text).join(" ");
    const userFocused = await reader.extractUserFocused({ sentences, text });
    const bookCoherence = await reader.extractBookCoherence({
      sentences,
      text,
      userFocusedChunks: userFocused.delta.chunks,
    });
    saveDelta(allChunks, successorIdsByChunkId, topology, userFocused.delta);
    saveDelta(allChunks, successorIdsByChunkId, topology, bookCoherence);
    reader.completeFragment({
      allChunks,
      getSuccessorChunkIds: (chunkId) =>
        successorIdsByChunkId[String(chunkId)] ?? [],
    });
    completedSentences += fragment.sentences.length;
    await options.progress?.updatePhase?.({
      done: completedSentences,
      phase: "reading-extraction",
      total: totalSentences,
      unit: "sentence",
    });
  }

  const result = await topology.finalize();
  for (const chunk of result.chunks) {
    yield {
      content: chunk.content,
      generation: chunk.generation,
      id: `chunk-${chunk.id}`,
      ...(chunk.importance === undefined
        ? {}
        : { importance: chunk.importance }),
      label: chunk.label,
      ...(chunk.retention === undefined ? {} : { retention: chunk.retention }),
      sentenceIndex: chunk.sentenceId[1],
      sentenceIndexes: chunk.sentenceIds.map((sentenceId) => sentenceId[1]),
      type: "reading-chunk",
      weight: chunk.weight,
      wordsCount: chunk.wordsCount,
    };
  }
  for (const edge of result.edges) {
    yield {
      fromChunkId: `chunk-${edge.fromId}`,
      ...(edge.strength === undefined ? {} : { strength: edge.strength }),
      toChunkId: `chunk-${edge.toId}`,
      type: "reading-edge",
      weight: edge.weight,
    };
  }
  for (const group of result.sentenceGroups) {
    yield {
      endSentenceIndex: group.endSentenceIndex,
      groupId: group.groupId,
      startSentenceIndex: group.startSentenceIndex,
      type: "fragment-group",
    };
  }
  for (const [index, snake] of result.snakes.entries()) {
    yield {
      firstLabel: snake.firstLabel,
      groupId: snake.groupId,
      id: `snake-${index + 1}`,
      lastLabel: snake.lastLabel,
      localSnakeId: snake.localSnakeId,
      size: snake.size,
      type: "snake",
      weight: snake.weight,
      wordsCount: snake.wordsCount,
    };
  }
  for (const item of result.snakeChunks) {
    yield {
      chunkId: `chunk-${item.chunkId}`,
      position: item.position,
      snakeId: `snake-${item.snakeIndex + 1}`,
      type: "snake-chunk",
    };
  }
  for (const edge of result.snakeEdges) {
    yield {
      fromSnakeId: `snake-${edge.fromSnakeIndex + 1}`,
      toSnakeId: `snake-${edge.toSnakeIndex + 1}`,
      type: "snake-edge",
      weight: edge.weight,
    };
  }
}

function saveDelta(
  allChunks: ReaderChunk[],
  successorIdsByChunkId: Record<string, number[] | undefined>,
  topology: Topology,
  delta: Parameters<Topology["accept"]>[0],
): void {
  topology.accept(delta);
  allChunks.push(...delta.chunks);
  for (const edge of delta.edges) {
    const successors = successorIdsByChunkId[String(edge.fromId)] ?? [];
    if (!successors.includes(edge.toId)) {
      successorIdsByChunkId[String(edge.fromId)] = [
        ...successors,
        edge.toId,
      ].sort((left, right) => left - right);
    }
  }
}

function createProcessingFragments(
  sentences: readonly JobSourceTextRecord[],
): readonly { readonly sentences: readonly JobSourceTextRecord[] }[] {
  const output: Array<{ readonly sentences: readonly JobSourceTextRecord[] }> =
    [];
  let pending: JobSourceTextRecord[] = [];
  let wordsCount = 0;
  for (const sentence of sentences) {
    if (
      pending.length > 0 &&
      wordsCount + sentence.wordsCount > DEFAULT_FRAGMENT_WORDS_COUNT
    ) {
      output.push({ sentences: pending });
      pending = [];
      wordsCount = 0;
    }
    if (sentence.text.trim() === "") continue;
    pending.push(sentence);
    wordsCount += sentence.wordsCount;
  }
  if (pending.length > 0) output.push({ sentences: pending });
  return output;
}

function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalized = prompt?.trim();
  return normalized === undefined || normalized === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalized;
}

async function readInput(file: JobFile): Promise<{
  readonly fragments: InputFragments;
  readonly jobOptions: JobOptionsRecord;
  readonly sentences: readonly JobSourceTextRecord[];
}> {
  const sentences: JobSourceTextRecord[] = [];
  let jobOptions: JobOptionsRecord = { type: "job-options" };
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "job-options") jobOptions = record;
    else if (record.type === "source-text") sentences.push(record);
  }
  sentences.sort((left, right) => left.sentenceIndex - right.sentenceIndex);
  return { fragments: new InputFragments(sentences), jobOptions, sentences };
}

class InputFragments implements ReadonlySerialFragments {
  readonly #fragments: readonly FragmentRecord[];
  readonly #sentences: ReadonlyMap<number, JobSourceTextRecord>;

  public constructor(sentences: readonly JobSourceTextRecord[]) {
    this.#sentences = new Map(
      sentences.map((sentence) => [sentence.sentenceIndex, sentence]),
    );
    const fragmentIds = [
      ...new Set(
        sentences.map(
          (sentence) => sentence.fragmentId ?? sentence.sentenceIndex,
        ),
      ),
    ].sort((left, right) => left - right);
    this.#fragments = fragmentIds.map((fragmentId) => ({
      fragmentId,
      sentences: sentences
        .filter(
          (sentence) =>
            (sentence.fragmentId ?? sentence.sentenceIndex) === fragmentId,
        )
        .map((sentence) => ({
          text: sentence.text,
          wordsCount: sentence.wordsCount,
        })),
      serialId: 0,
    }));
  }

  public getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fragment = this.#fragments.find(
      (candidate) => candidate.fragmentId === fragmentId,
    );
    if (fragment === undefined) {
      return Promise.reject(new Error(`Unknown fragment ${fragmentId}.`));
    }
    return Promise.resolve(fragment);
  }

  public listFragmentIds(): Promise<readonly number[]> {
    return Promise.resolve(
      this.#fragments.map((fragment) => fragment.fragmentId),
    );
  }

  public getSentence(sentenceId: readonly [number, number]): Promise<string> {
    const sentence = this.#sentences.get(sentenceId[1]);
    if (sentence === undefined) {
      return Promise.reject(
        new Error(`Unknown source sentence ${sentenceId[1]}.`),
      );
    }
    return Promise.resolve(sentence.text);
  }
}
