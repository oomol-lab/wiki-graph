import type {
  ChapterJobArtifactRecord,
  JobFragmentGroupRecord,
  JobOptionsRecord,
  JobReadingChunkRecord,
  JobSnakeChunkRecord,
  JobSnakeRecord,
  JobSourceSentenceRecord,
} from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import type { JobFile } from "./platform.js";
import type { JobLlm, JobProgressSink } from "./ports.js";
import {
  expectChunkImportance,
  expectChunkRetention,
  type ChunkRecord,
  type FragmentRecord,
  type ReadonlySerialFragments,
  type SentenceGroupRecord,
} from "./reading/model.js";
import { createReadingLlm } from "./reading/llm.js";
import { compressText } from "./summary/editor/compression.js";
import type { SnakeRecord, SummaryDocument } from "./summary/model.js";

export async function* buildReadingSummaryRecords(options: {
  readonly inputFile: JobFile;
  readonly llm: JobLlm;
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const input = await SummaryInputDocument.read(options.inputFile);
  const fragmentIds = await input.fragments.listFragmentIds();
  if (fragmentIds.length <= 1) {
    const text = await input.fragments.readText();
    if (text !== "") yield { position: 0, text, type: "summary-part" };
    return;
  }

  const llm = createReadingLlm(options);
  const groupIds = [
    ...new Set(input.groups.map((group) => group.groupId)),
  ].sort((left, right) => left - right);
  let position = 0;
  for (const [index, groupId] of groupIds.entries()) {
    await options.progress?.throwIfStopped?.();
    const summary = await compressText({
      compressionRatio: 0.2,
      document: input,
      groupId,
      llm,
      maxClues: 10,
      maxIterations: 5,
      scopes: {
        compress: "reading-summary-compress",
        review: "reading-summary-review",
        reviewGuide: "reading-summary-review-guide",
      },
      serialId: 0,
      ...(input.jobOptions.language === undefined
        ? {}
        : { userLanguage: input.jobOptions.language }),
    });
    if (summary.trim() !== "") {
      yield { position, text: summary.trim(), type: "summary-part" };
      position += 1;
    }
    await options.progress?.updatePhase?.({
      done: index + 1,
      phase: "summary-compression",
      total: groupIds.length,
      unit: "item",
    });
  }
}

class SummaryInputDocument implements SummaryDocument {
  public readonly chunks: SummaryChunkStore;
  public readonly fragmentGroups: SummaryFragmentGroupStore;
  public readonly fragments: SummaryFragments;
  public readonly groups: readonly SentenceGroupRecord[];
  public readonly jobOptions: JobOptionsRecord;
  public readonly snakeChunks: SummarySnakeChunkStore;
  public readonly snakes: SummarySnakeStore;

  public constructor(input: {
    readonly chunks: readonly ChunkRecord[];
    readonly fragments: SummaryFragments;
    readonly groups: readonly SentenceGroupRecord[];
    readonly jobOptions: JobOptionsRecord;
    readonly snakeChunks: readonly {
      readonly chunkId: number;
      readonly snakeId: number;
    }[];
    readonly snakes: readonly SnakeRecord[];
  }) {
    this.chunks = new SummaryChunkStore(input.chunks);
    this.fragmentGroups = new SummaryFragmentGroupStore(input.groups);
    this.fragments = input.fragments;
    this.groups = input.groups;
    this.jobOptions = input.jobOptions;
    this.snakeChunks = new SummarySnakeChunkStore(input.snakeChunks);
    this.snakes = new SummarySnakeStore(input.snakes);
  }

  public static async read(file: JobFile): Promise<SummaryInputDocument> {
    const sourceSentences: JobSourceSentenceRecord[] = [];
    const fragmentSummaries = new Map<number, string>();
    const chunkRecords: JobReadingChunkRecord[] = [];
    const groupRecords: JobFragmentGroupRecord[] = [];
    const snakeRecords: JobSnakeRecord[] = [];
    const snakeChunkRecords: JobSnakeChunkRecord[] = [];
    let jobOptions: JobOptionsRecord = { type: "job-options" };
    for await (const record of readChapterJobInput(file)) {
      switch (record.type) {
        case "job-options":
          jobOptions = record;
          break;
        case "source-fragment":
          fragmentSummaries.set(record.fragmentId, record.summary);
          break;
        case "source-sentence":
          sourceSentences.push(record);
          break;
        case "reading-chunk":
          chunkRecords.push(record);
          break;
        case "fragment-group":
          groupRecords.push(record);
          break;
        case "snake":
          snakeRecords.push(record);
          break;
        case "snake-chunk":
          snakeChunkRecords.push(record);
          break;
        default:
          break;
      }
    }
    sourceSentences.sort(
      (left, right) => left.sentenceIndex - right.sentenceIndex,
    );
    const chunkIds = new Map(
      chunkRecords.map((chunk, index) => [chunk.id, index + 1]),
    );
    const snakeIds = new Map(
      snakeRecords.map((snake, index) => [snake.id, index + 1]),
    );
    const chunks: ChunkRecord[] = chunkRecords.map((chunk) => ({
      content: chunk.content,
      generation: chunk.generation,
      id: requireId(chunkIds, chunk.id, "chunk"),
      ...(chunk.importance === undefined
        ? {}
        : { importance: expectChunkImportance(chunk.importance) }),
      label: chunk.label,
      ...(chunk.retention === undefined
        ? {}
        : { retention: expectChunkRetention(chunk.retention) }),
      sentenceId: [0, chunk.sentenceIndex],
      sentenceIds: chunk.sentenceIndexes.map(
        (sentenceIndex) => [0, sentenceIndex] as const,
      ),
      weight: chunk.weight,
      wordsCount: chunk.wordsCount,
    }));
    return new SummaryInputDocument({
      chunks,
      fragments: new SummaryFragments(sourceSentences, fragmentSummaries),
      groups: groupRecords.map((group) => ({
        endSentenceIndex: group.endSentenceIndex,
        groupId: group.groupId,
        serialId: 0,
        startSentenceIndex: group.startSentenceIndex,
      })),
      jobOptions,
      snakeChunks: snakeChunkRecords.map((item) => ({
        chunkId: requireId(chunkIds, item.chunkId, "chunk"),
        snakeId: requireId(snakeIds, item.snakeId, "snake"),
      })),
      snakes: snakeRecords.map((snake) => ({
        firstLabel: snake.firstLabel,
        groupId: snake.groupId,
        id: requireId(snakeIds, snake.id, "snake"),
        lastLabel: snake.lastLabel,
        localSnakeId: snake.localSnakeId,
        serialId: 0,
        size: snake.size,
        weight: snake.weight,
        wordsCount: snake.wordsCount,
      })),
    });
  }

  public getSerialFragments(_serialId: number): SummaryFragments {
    return this.fragments;
  }
}

class SummaryFragments implements ReadonlySerialFragments {
  readonly #fragments: readonly FragmentRecord[];
  readonly #sentences: readonly JobSourceSentenceRecord[];

  public constructor(
    sentences: readonly JobSourceSentenceRecord[],
    summaries: ReadonlyMap<number, string>,
  ) {
    this.#sentences = sentences;
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
      summary: summaries.get(fragmentId) ?? "",
    }));
  }

  public getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fragment = this.#fragments.find(
      (candidate) => candidate.fragmentId === fragmentId,
    );
    return fragment === undefined
      ? Promise.reject(new Error(`Unknown fragment ${fragmentId}.`))
      : Promise.resolve(fragment);
  }

  public listFragmentIds(): Promise<readonly number[]> {
    return Promise.resolve(
      this.#fragments.map((fragment) => fragment.fragmentId),
    );
  }

  public listSentencesInRange(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<
    readonly { readonly text: string; readonly wordsCount: number }[]
  > {
    return Promise.resolve(
      this.#sentences
        .filter(
          (sentence) =>
            sentence.sentenceIndex >= startSentenceIndex &&
            sentence.sentenceIndex <= endSentenceIndex,
        )
        .map((sentence) => ({
          text: sentence.text,
          wordsCount: sentence.wordsCount,
        })),
    );
  }

  public readText(): Promise<string> {
    return Promise.resolve(
      this.#sentences
        .map((sentence) => sentence.text)
        .join(" ")
        .trim(),
    );
  }
}

class SummaryChunkStore {
  readonly #byId: ReadonlyMap<number, ChunkRecord>;
  public constructor(chunks: readonly ChunkRecord[]) {
    this.#byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  }
  public getById(chunkId: number): Promise<ChunkRecord | undefined> {
    return Promise.resolve(this.#byId.get(chunkId));
  }
}

class SummaryFragmentGroupStore {
  readonly #groups: readonly SentenceGroupRecord[];
  public constructor(groups: readonly SentenceGroupRecord[]) {
    this.#groups = groups;
  }
  public listBySerial(
    serialId: number,
  ): Promise<readonly SentenceGroupRecord[]> {
    return Promise.resolve(
      this.#groups.filter((group) => group.serialId === serialId),
    );
  }
}

class SummarySnakeStore {
  readonly #byId: ReadonlyMap<number, SnakeRecord>;
  readonly #values: readonly SnakeRecord[];
  public constructor(values: readonly SnakeRecord[]) {
    this.#values = values;
    this.#byId = new Map(values.map((snake) => [snake.id, snake]));
  }
  public getById(snakeId: number): Promise<SnakeRecord | undefined> {
    return Promise.resolve(this.#byId.get(snakeId));
  }
  public listIdsByGroup(serialId: number, groupId: number): Promise<number[]> {
    return Promise.resolve(
      this.#values
        .filter(
          (snake) => snake.serialId === serialId && snake.groupId === groupId,
        )
        .map((snake) => snake.id),
    );
  }
}

class SummarySnakeChunkStore {
  readonly #values: readonly {
    readonly chunkId: number;
    readonly snakeId: number;
  }[];
  public constructor(
    values: readonly {
      readonly chunkId: number;
      readonly snakeId: number;
    }[],
  ) {
    this.#values = values;
  }
  public listChunkIds(snakeId: number): Promise<number[]> {
    return Promise.resolve(
      this.#values
        .filter((item) => item.snakeId === snakeId)
        .map((item) => item.chunkId),
    );
  }
}

function requireId(
  ids: ReadonlyMap<string, number>,
  id: string,
  kind: string,
): number {
  const mapped = ids.get(id);
  if (mapped === undefined) throw new Error(`Unknown ${kind} id ${id}.`);
  return mapped;
}
