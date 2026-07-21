import { AsyncSemaphore } from "../../utils/async-semaphore.js";
import type { Language } from "../../runtime/common/language.js";
import {
  WIKI_GRAPH_EDITOR_SCOPES,
  WIKI_GRAPH_READER_SCOPES,
  type WikiGraphScope,
} from "../../runtime/common/llm-scope.js";
import type {
  Document,
  FragmentGroupStore,
  SerialStore,
  SerialTextStream,
} from "../../document/index.js";
import { compressText, type EditorOptions } from "../editor/index.js";
import { Reader, type ReaderChunk } from "../reader/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import { Topology } from "../../graph/topology/index.js";
import {
  countFragmentWords,
  listSerialProcessingFragments,
  readSerialPassthroughSummary,
} from "./fragments.js";
import {
  DEFAULT_COMPRESSION_RATIO,
  DEFAULT_FRAGMENT_WORDS_COUNT,
  DEFAULT_GENERATION_DECAY_FACTOR,
  DEFAULT_GROUP_WORDS_COUNT,
  DEFAULT_MAX_CLUES,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_WORKING_MEMORY_CAPACITY,
  type BuildSerialSummaryOptions,
  type BuildSerialTopologyOptions,
  type GenerateSerialOptions,
  type SerialGenerationOptions,
  type SerialProgressSink,
} from "./options.js";
import { getSerialRecord, resolveDocument } from "./record.js";
import { createNumberListRecord, saveDelta } from "./reader-graph.js";
import { writeSerialSource } from "./source.js";
import { Serial } from "./topology.js";

type ReaderProgressScope =
  (typeof WIKI_GRAPH_READER_SCOPES)[keyof typeof WIKI_GRAPH_READER_SCOPES];

export class SerialGeneration {
  readonly #fragmentWordsCount = DEFAULT_FRAGMENT_WORDS_COUNT;
  readonly #fragmentGroups: FragmentGroupStore;
  readonly #idSemaphore = new AsyncSemaphore(1);
  readonly #logDirPath: string | undefined;
  readonly #serials: SerialStore;
  readonly #document: Document;
  readonly #writeSemaphore = new AsyncSemaphore(1);
  readonly #llm: SerialGenerationOptions["llm"];
  readonly #segmenter: SerialGenerationOptions["segmenter"];

  #nextChunkId = 1;

  public constructor(options: SerialGenerationOptions) {
    const document = resolveDocument(options);

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
    const serialId = await this.#createSerialId();
    await writeSerialSource(this.#document, serialId, stream, {
      ...(this.#segmenter === undefined ? {} : { segmenter: this.#segmenter }),
    });
    return await this.#generatePrepared(serialId, options, progressTracker);
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
    await writeSerialSource(this.#document, serialId, stream, {
      ...(this.#segmenter === undefined ? {} : { segmenter: this.#segmenter }),
    });
    return await this.#generatePrepared(serialId, options, progressTracker);
  }

  public async buildTopologyInto(
    serialId: number,
    options: BuildSerialTopologyOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<void> {
    await this.#buildTopology(
      serialId,
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
    options: GenerateSerialOptions,
    progressTracker?: SerialProgressSink,
  ): Promise<Serial> {
    await this.#buildTopology(
      serialId,
      options.extractionPrompt,
      options.userLanguage,
      progressTracker,
    );

    const summary = await this.#buildSummary(serialId, options.userLanguage);
    await progressTracker?.complete();

    return new Serial(this.#document, serialId, summary);
  }

  async #allocateChunkId(): Promise<number> {
    return await this.#idSemaphore.use(() => {
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
      scopes: WIKI_GRAPH_READER_SCOPES,
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
    const serialFragments = this.#document.getSerialFragments(serialId);

    for (const fragment of await listSerialProcessingFragments(
      serialFragments,
      this.#fragmentWordsCount,
    )) {
      const wordsCount = countFragmentWords(fragment.sentences);

      await this.#processFragment({
        allChunks,
        fragment: {
          startSentenceIndex: fragment.startSentenceIndex,
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
      await this.#serials.bumpRevision(serialId);
    });
  }

  async #processFragment(input: {
    readonly allChunks: ReaderChunk[];
    readonly fragment: {
      readonly startSentenceIndex: number;
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
    const sentences = input.fragment.sentences.map((sentence, index) => ({
      sentenceId: [
        input.serialId,
        input.fragment.startSentenceIndex + index,
      ] as const,
      text: sentence.text,
      wordsCount: sentence.wordsCount,
    }));
    const fragmentText = sentences.map((sentence) => sentence.text).join(" ");
    const userFocused = await input.reader.extractUserFocused({
      sentences,
      text: fragmentText,
    });

    const bookCoherence = await input.reader.extractBookCoherence({
      sentences,
      text: fragmentText,
      userFocusedChunks: userFocused.delta.chunks,
    });

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

  #getSerialFragments(serialId: number): SerialTextStream {
    return this.#document.getSerialFragments(serialId);
  }

  #createEditorOptions(input: {
    groupId: number;
    serialId: number;
    userLanguage: Language | undefined;
  }): EditorOptions<WikiGraphScope> {
    return {
      compressionRatio: DEFAULT_COMPRESSION_RATIO,
      groupId: input.groupId,
      llm: this.#llm,
      maxClues: DEFAULT_MAX_CLUES,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
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
