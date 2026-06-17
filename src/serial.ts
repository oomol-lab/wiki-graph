import { AsyncSemaphore } from "./utils/async-semaphore.js";
import type { Language } from "./common/language.js";
import {
  SPINE_DIGEST_EDITOR_SCOPES,
  SPINE_DIGEST_READER_SCOPES,
  type SpineDigestScope,
} from "./common/llm-scope.js";
import type { LLM } from "./llm/index.js";
import type {
  ChunkRecord,
  ChunkStore,
  Document,
  FragmentGroupRecord,
  FragmentGroupStore,
  KnowledgeEdgeRecord,
  ReadonlyChunkStore,
  ReadonlyDocument,
  ReadonlyFragmentGroupStore,
  ReadonlyKnowledgeEdgeStore,
  ReadonlySerialFragments,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SerialFragments,
  SerialRecord,
  SerialStore,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "./document/index.js";
import { Reader, segmentTextStream } from "./reader/index.js";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderSegmenter,
  ReaderTextStream,
} from "./reader/index.js";
import { compressText, type EditorOptions } from "./editor/index.js";
import { Topology } from "./topology/index.js";

const DEFAULT_COMPRESSION_RATIO = 0.2;
const DEFAULT_FRAGMENT_WORDS_COUNT = 320;
const DEFAULT_GENERATION_DECAY_FACTOR = 0.5;
const DEFAULT_GROUP_WORDS_COUNT = 3840;
const DEFAULT_MAX_CLUES = 10;
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_WORKING_MEMORY_CAPACITY = 7;

export interface GenerateSerialOptions {
  readonly extractionPrompt: string;
  readonly userLanguage?: Language;
}

export type BuildSerialTopologyOptions = GenerateSerialOptions;

export interface BuildSerialSummaryOptions {
  readonly userLanguage?: Language;
}

export interface WriteSerialSourceOptions {
  readonly segmenter?: ReaderSegmenter;
}

export interface SerialDiscovery {
  readonly fragments: number;
  readonly words: number;
}

export interface SerialProgressSink {
  begin?(input?: {
    readonly fragments: number;
    readonly words: number;
  }): Promise<void>;
  advance(wordsCount: number): Promise<void>;
  complete(finalWordsCount?: number): Promise<void>;
}

type ReaderProgressScope =
  (typeof SPINE_DIGEST_READER_SCOPES)[keyof typeof SPINE_DIGEST_READER_SCOPES];

export type CreateSerialOptions = GenerateSerialOptions;

export interface SerialGenerationOptions {
  readonly document?: Document;
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly segmenter?: ReaderSegmenter;
  /** @deprecated Use `document` instead. */
  readonly workspace?: Document;
}

export type SerialHubOptions = SerialGenerationOptions;

export async function discoverSerial(input: {
  readonly segmenter?: ReaderSegmenter;
  readonly stream: ReaderTextStream;
}): Promise<SerialDiscovery> {
  let fragments = 0;
  let words = 0;

  for await (const fragment of streamFragments({
    maxWordsCount: DEFAULT_FRAGMENT_WORDS_COUNT,
    stream: segmentTextStream(input.stream, {
      ...(input.segmenter === undefined ? {} : { adapter: input.segmenter }),
    }),
  })) {
    fragments += 1;
    words += countFragmentWords(fragment.sentences);
  }

  return {
    fragments,
    words,
  };
}

export async function writeSerialSource(
  document: Document,
  serialId: number,
  stream: ReaderTextStream,
  options: WriteSerialSourceOptions = {},
): Promise<void> {
  const serialFragments = document.getSerialFragments(serialId);

  for await (const fragment of streamFragments({
    maxWordsCount: DEFAULT_FRAGMENT_WORDS_COUNT,
    stream: segmentTextStream(stream, {
      ...(options.segmenter === undefined
        ? {}
        : { adapter: options.segmenter }),
    }),
  })) {
    const fragmentDraft = await serialFragments.createDraft();

    for (const sentence of fragment.sentences) {
      fragmentDraft.addSentence(sentence.text, sentence.wordsCount);
    }

    await fragmentDraft.commit();
  }
}

export class SerialGeneration {
  readonly #chunks: ChunkStore;
  readonly #fragmentWordsCount = DEFAULT_FRAGMENT_WORDS_COUNT;
  readonly #fragmentGroups: FragmentGroupStore;
  readonly #idSemaphore = new AsyncSemaphore(1);
  readonly #llm: LLM<SpineDigestScope>;
  readonly #logDirPath: string | undefined;
  readonly #serials: SerialStore;
  readonly #segmenter: ReaderSegmenter | undefined;
  readonly #document: Document;
  readonly #writeSemaphore = new AsyncSemaphore(1);

  #nextChunkId: number | undefined;

  public constructor(options: SerialGenerationOptions) {
    const document = resolveDocument(options);

    this.#chunks = document.chunks;
    this.#fragmentGroups = document.fragmentGroups;
    this.#llm = options.llm;
    this.#logDirPath = options.logDirPath;
    this.#serials = document.serials;
    this.#segmenter = options.segmenter;
    this.#document = document;
  }

  public async generate(
    stream: ReaderTextStream,
    options: GenerateSerialOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<Serial> {
    return await this.#generatePrepared(
      await this.#createSerialId(),
      stream,
      options,
      progressTracker,
    );
  }

  public async create(
    stream: ReaderTextStream,
    options: GenerateSerialOptions,
  ): Promise<Serial> {
    return await this.generate(stream, options);
  }

  public async generateInto(
    serialId: number,
    stream: ReaderTextStream,
    options: GenerateSerialOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<Serial> {
    await this.#createExplicitSerialId(serialId);
    return await this.#generatePrepared(
      serialId,
      stream,
      options,
      progressTracker,
    );
  }

  public async buildTopologyInto(
    serialId: number,
    stream: ReaderTextStream,
    options: BuildSerialTopologyOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<void> {
    await this.#buildTopology(
      serialId,
      stream,
      options.extractionPrompt,
      options.userLanguage,
      progressTracker,
    );
  }

  public async buildSummary(
    serialId: number,
    options: BuildSerialSummaryOptions = {},
  ): Promise<Serial> {
    const summary = await this.#buildSummary(serialId, options.userLanguage);

    return new Serial(this.#document, serialId, summary);
  }

  async #generatePrepared(
    serialId: number,
    stream: ReaderTextStream,
    options: GenerateSerialOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<Serial> {
    await this.#buildTopology(
      serialId,
      stream,
      options.extractionPrompt,
      options.userLanguage,
      progressTracker,
    );

    const summary = await this.#buildSummary(serialId, options.userLanguage);
    await progressTracker?.complete();

    return new Serial(this.#document, serialId, summary);
  }

  async #allocateChunkId(): Promise<number> {
    return await this.#idSemaphore.use(async () => {
      if (this.#nextChunkId === undefined) {
        this.#nextChunkId = (await this.#chunks.getMaxId()) + 1;
      }
      const chunkId = this.#nextChunkId;
      this.#nextChunkId += 1;
      return chunkId;
    });
  }

  async #buildSummary(
    serialId: number,
    userLanguage: Language | undefined,
  ): Promise<string> {
    const record = await getSerialRecord(this.#document, serialId);
    if (!record.topologyReady) {
      throw new Error(`Serial ${serialId} is not ready for summary`);
    }
    const existingSummary = await this.#document.readSummary(serialId);

    if (existingSummary !== undefined) {
      return existingSummary;
    }
    const serialFragments = this.#getSerialFragments(serialId);
    const fragmentIds = await serialFragments.listFragmentIds();

    if (fragmentIds.length <= 1) {
      const summary = await readSerialPassthroughSummary(
        serialFragments,
        fragmentIds,
      );

      await this.#writeSemaphore.use(
        async () => await this.#document.writeSummary(serialId, summary),
      );

      return summary;
    }
    const groupIds = await this.#fragmentGroups.listGroupIdsForSerial(serialId);
    const summaryParts: string[] = [];

    for (const groupId of groupIds) {
      const groupSummary = await compressText({
        ...this.#createEditorOptions({
          groupId,
          serialId,
          userLanguage,
        }),
      });
      if (groupSummary.trim() === "") {
        continue;
      }
      summaryParts.push(groupSummary);
    }
    const summary = summaryParts.join("\n\n");

    await this.#writeSemaphore.use(
      async () => await this.#document.writeSummary(serialId, summary),
    );
    return summary;
  }

  async #buildTopology(
    serialId: number,
    stream: ReaderTextStream,
    extractionPrompt: string,
    userLanguage: Language | undefined,
    progressTracker?: SerialProgressSink,
  ): Promise<void> {
    const reader = new Reader({
      attention: {
        capacity: DEFAULT_WORKING_MEMORY_CAPACITY,
        generationDecayFactor: DEFAULT_GENERATION_DECAY_FACTOR,
        idGenerator: async () => await this.#allocateChunkId(),
      },
      extractionGuidance: extractionPrompt,
      llm: this.#llm,
      scopes: SPINE_DIGEST_READER_SCOPES,
      sentenceTextSource: this.#document,
      ...(this.#segmenter === undefined
        ? {}
        : {
            segmenter: this.#segmenter,
          }),
      ...(userLanguage === undefined
        ? {}
        : {
            userLanguage,
          }),
    });
    const topology = new Topology(
      this.#document,
      serialId,
      DEFAULT_GROUP_WORDS_COUNT,
    );
    const allChunks: ReaderChunk[] = [];
    const successorIdsByChunkId = createNumberListRecord();
    for await (const fragment of streamFragments({
      maxWordsCount: this.#fragmentWordsCount,
      stream: reader.segment(stream),
    })) {
      const wordsCount = countFragmentWords(fragment.sentences);

      await this.#processFragment({
        allChunks,
        fragment: {
          sentences: fragment.sentences,
        },
        reader,
        serialId,
        successorIdsByChunkId,
        topology,
      });
      // Progress only advances after the fragment is fully persisted and indexed.
      await progressTracker?.advance(wordsCount);
    }

    await this.#writeSemaphore.use(async () => {
      await topology.finalize();
      await this.#serials.setTopologyReady(serialId);
    });
  }

  async #processFragment(input: {
    readonly allChunks: ReaderChunk[];
    readonly fragment: {
      readonly sentences: ReadonlyArray<{
        readonly text: string;
        readonly wordsCount: number;
      }>;
    };
    readonly reader: Reader<ReaderProgressScope>;
    readonly serialId: number;
    readonly successorIdsByChunkId: Record<string, number[] | undefined>;
    readonly topology: Topology;
  }): Promise<void> {
    const serialFragments = this.#getSerialFragments(input.serialId);
    const fragmentDraft = await serialFragments.createDraft();
    const sentences = input.fragment.sentences.map((sentence) => ({
      sentenceId: fragmentDraft.addSentence(sentence.text, sentence.wordsCount),
      text: sentence.text,
      wordsCount: sentence.wordsCount,
    }));
    const fragmentText = sentences.map((sentence) => sentence.text).join(" ");
    const userFocused = await input.reader.extractUserFocused({
      sentences,
      text: fragmentText,
    });

    if (userFocused.fragmentSummary.trim() !== "") {
      fragmentDraft.setSummary(userFocused.fragmentSummary);
    }

    const bookCoherence = await input.reader.extractBookCoherence({
      sentences,
      text: fragmentText,
      userFocusedChunks: userFocused.delta.chunks,
    });

    await fragmentDraft.commit();
    saveDelta(
      input.allChunks,
      input.successorIdsByChunkId,
      input.topology,
      userFocused.delta,
    );
    saveDelta(
      input.allChunks,
      input.successorIdsByChunkId,
      input.topology,
      bookCoherence,
    );
    input.reader.completeFragment({
      allChunks: input.allChunks,
      getSuccessorChunkIds: (chunkId) =>
        input.successorIdsByChunkId[String(chunkId)] ?? [],
    });
  }

  async #createSerialId(): Promise<number> {
    return await this.#idSemaphore.use(
      async () => await this.#serials.create(),
    );
  }

  async #createExplicitSerialId(serialId: number): Promise<void> {
    await this.#idSemaphore.use(
      async () => await this.#serials.createWithId(serialId),
    );
  }

  #getSerialFragments(serialId: number): SerialFragments {
    return this.#document.getSerialFragments(serialId);
  }

  #createEditorOptions(input: {
    groupId: number;
    serialId: number;
    userLanguage: Language | undefined;
  }): EditorOptions<SpineDigestScope> {
    return {
      compressionRatio: DEFAULT_COMPRESSION_RATIO,
      groupId: input.groupId,
      llm: this.#llm,
      maxClues: DEFAULT_MAX_CLUES,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      scopes: SPINE_DIGEST_EDITOR_SCOPES,
      serialId: input.serialId,
      document: this.#document,
      ...(this.#logDirPath === undefined
        ? {}
        : {
            logDirPath: this.#logDirPath,
          }),
      ...(input.userLanguage === undefined
        ? {}
        : {
            userLanguage: input.userLanguage,
          }),
    };
  }
}

export class Serial {
  readonly #id: number;
  readonly #summary: string;
  readonly #topology: SerialTopology;

  public constructor(
    document: ReadonlyDocument,
    serialId: number,
    summary: string,
  ) {
    this.#id = serialId;
    this.#summary = summary;
    this.#topology = new SerialTopology(document, serialId);
  }

  public get id(): number {
    return this.#id;
  }

  public getSummary(): string {
    return this.#summary;
  }

  public getTopology(): SerialTopology {
    return this.#topology;
  }
}

export class SerialTopology {
  readonly #chunks: ReadonlyChunkStore;
  readonly #fragmentGroups: ReadonlyFragmentGroupStore;
  readonly #knowledgeEdges: ReadonlyKnowledgeEdgeStore;
  readonly #serialId: number;
  readonly #snakeChunks: ReadonlySnakeChunkStore;
  readonly #snakeEdges: ReadonlySnakeEdgeStore;
  readonly #snakes: ReadonlySnakeStore;

  public constructor(document: ReadonlyDocument, serialId: number) {
    this.#chunks = document.chunks;
    this.#fragmentGroups = document.fragmentGroups;
    this.#knowledgeEdges = document.knowledgeEdges;
    this.#serialId = serialId;
    this.#snakeChunks = document.snakeChunks;
    this.#snakeEdges = document.snakeEdges;
    this.#snakes = document.snakes;
  }

  public async listChunks(): Promise<readonly ChunkRecord[]> {
    return await this.#chunks.listBySerial(this.#serialId);
  }

  public async listEdges(): Promise<readonly KnowledgeEdgeRecord[]> {
    return await this.#knowledgeEdges.listBySerial(this.#serialId);
  }

  public async listGroups(): Promise<readonly FragmentGroupRecord[]> {
    return await this.#fragmentGroups.listBySerial(this.#serialId);
  }

  public async listSnakeChunks(
    snakeId: number,
  ): Promise<readonly SnakeChunkRecord[]> {
    const snake = await this.#snakes.getById(snakeId);
    if (snake === undefined || snake.serialId !== this.#serialId) {
      throw new Error(`Snake ${snakeId} does not belong to this serial`);
    }
    return await this.#snakeChunks.listBySnake(snakeId);
  }

  public async listSnakeEdges(): Promise<readonly SnakeEdgeRecord[]> {
    return await this.#snakeEdges.listBySerial(this.#serialId);
  }

  public async listSnakes(): Promise<readonly SnakeRecord[]> {
    return await this.#snakes.listBySerial(this.#serialId);
  }
}

function appendSuccessor(
  successorIdsByChunkId: Record<string, number[] | undefined>,
  fromId: number,
  toId: number,
): void {
  const existingSuccessors = successorIdsByChunkId[String(fromId)] ?? [];

  if (existingSuccessors.includes(toId)) {
    return;
  }

  successorIdsByChunkId[String(fromId)] = [...existingSuccessors, toId].sort(
    compareNumber,
  );
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

export async function readSerial(
  document: ReadonlyDocument,
  serialId: number,
): Promise<Serial> {
  const record = await getSerialRecord(document, serialId);

  if (!record.topologyReady) {
    throw new Error(`Serial ${serialId} is not ready`);
  }

  const summary = await document.readSummary(serialId);

  if (summary === undefined) {
    throw new Error(
      `Chapter ${serialId} summary is missing. Run \`spinedigest build <archive.sdpub> --stage summary --confirm\` before export, or inspect the chapter with \`spinedigest page <archive.sdpub> --chapter ${serialId}\`.`,
    );
  }

  return new Serial(document, serialId, summary);
}

function resolveDocument(options: SerialGenerationOptions): Document {
  const document = options.document ?? options.workspace;

  if (document === undefined) {
    throw new Error("SerialGeneration requires a document");
  }

  return document;
}

async function getSerialRecord(
  document: Pick<ReadonlyDocument, "serials">,
  serialId: number,
): Promise<SerialRecord> {
  const record = await document.serials.getById(serialId);

  if (record === undefined) {
    throw new Error(
      `Chapter ${serialId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
    );
  }

  return record;
}

function saveDelta(
  allChunks: ReaderChunk[],
  successorIdsByChunkId: Record<string, number[] | undefined>,
  topology: Topology,
  delta: ReaderGraphDelta,
): void {
  topology.accept(delta);
  allChunks.push(...delta.chunks);

  for (const edge of delta.edges) {
    appendSuccessor(successorIdsByChunkId, edge.fromId, edge.toId);
  }
}

async function* streamFragments(input: {
  maxWordsCount: number;
  stream: AsyncIterable<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}): AsyncIterable<{
  readonly sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}> {
  let currentSentences: Array<{
    readonly text: string;
    readonly wordsCount: number;
  }> = [];
  let currentWordsCount = 0;

  for await (const sentence of input.stream) {
    const sentenceText = sentence.text.trim();

    if (sentenceText === "") {
      continue;
    }
    if (
      currentSentences.length > 0 &&
      currentWordsCount + sentence.wordsCount > input.maxWordsCount
    ) {
      yield {
        sentences: currentSentences,
      };
      currentSentences = [];
      currentWordsCount = 0;
    }
    currentSentences.push({
      text: sentenceText,
      wordsCount: sentence.wordsCount,
    });
    currentWordsCount += sentence.wordsCount;
  }

  if (currentSentences.length > 0) {
    yield {
      sentences: currentSentences,
    };
  }
}

function countFragmentWords(
  sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>,
): number {
  return sentences.reduce((sum, sentence) => sum + sentence.wordsCount, 0);
}

async function readSerialPassthroughSummary(
  fragments: ReadonlySerialFragments,
  fragmentIds: readonly number[],
): Promise<string> {
  if (fragmentIds.length === 0) {
    return "";
  }

  const records = await Promise.all(
    fragmentIds.map(
      async (fragmentId) => await fragments.getFragment(fragmentId),
    ),
  );

  return records
    .flatMap((fragment: Awaited<ReturnType<typeof fragments.getFragment>>) =>
      fragment.sentences.map((sentence) => sentence.text),
    )
    .join(" ")
    .trim();
}
