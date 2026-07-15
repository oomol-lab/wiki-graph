import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";

import type {
  ChunkRecord,
  Document,
  FragmentRecord,
  ReadingEdgeRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyChunkStore,
  ReadonlyDocument,
  ReadonlyFragmentGroupStore,
  ReadonlyGraphBuildParameterStore,
  ReadonlyReadingEdgeStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
  ReadonlySerialFragments,
  ReadonlySerialStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SentenceId,
  SentenceGroupRecord,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../document/index.js";
import { DirectoryDocument, Fragments } from "../document/index.js";
import { WIKI_GRAPH_EDITOR_SCOPES } from "../common/llm-scope.js";
import { normalizeLanguageCode } from "../common/language.js";
import { compressText } from "../editor/index.js";
import { segmentTextStream, type ReaderTextStream } from "../reader/index.js";
import {
  SerialGeneration,
  type BuildSerialTopologyOptions,
} from "../serial.js";
import { ChunkImportance, ChunkRetention } from "../document/types.js";

import {
  getChapterDetails,
  type ChapterDetails,
  type GenerateChapterGraphOptions,
  type GenerateChapterSummaryOptions,
} from "./chapter.js";

export interface ChapterGraphBuildArtifact {
  readonly documentPath: string;
  readonly chapterId: number;
  readonly parameter: GraphBuildParameterInput;
}

export interface GraphBuildParameterInput {
  readonly language?: string;
  readonly prompt: string;
}

export interface ChapterSummaryInputSnapshot {
  readonly filePath: string;
}

export interface BuildChapterGraphArtifactOptions extends GenerateChapterGraphOptions {
  readonly sourceText: readonly string[];
  readonly workspacePath: string;
}

export interface BuildChapterSummaryArtifactOptions extends GenerateChapterSummaryOptions {
  readonly snapshotPath?: string;
  readonly sourceDocumentPath?: string;
  readonly workspacePath: string;
}

const sentenceIdSchema = z.tuple([
  z.number(),
  z.number(),
]) satisfies z.ZodType<SentenceId>;
const GRAPH_ARTIFACT_FRAGMENT_WORDS_COUNT = 320;
const sentenceRecordSchema = z.object({
  text: z.string(),
  wordsCount: z.number(),
});
const fragmentRecordSchema = z.object({
  serialId: z.number(),
  fragmentId: z.number(),
  summary: z.string(),
  sentences: z.array(sentenceRecordSchema),
}) satisfies z.ZodType<FragmentRecord>;
const serialRecordSchema = z
  .object({
    documentOrder: z.number().optional(),
    id: z.number(),
    knowledgeGraphReady: z.boolean(),
    knowledgeGraphParameterHash: z.string().optional(),
    revision: z.number().optional(),
    topologyParameterHash: z.string().optional(),
    topologyReady: z.boolean(),
  })
  .transform((record) => ({
    documentOrder: record.documentOrder ?? record.id,
    id: record.id,
    knowledgeGraphReady: record.knowledgeGraphReady,
    ...(record.knowledgeGraphParameterHash === undefined
      ? {}
      : { knowledgeGraphParameterHash: record.knowledgeGraphParameterHash }),
    revision: record.revision ?? 0,
    topologyReady: record.topologyReady,
    ...(record.topologyParameterHash === undefined
      ? {}
      : { topologyParameterHash: record.topologyParameterHash }),
  })) satisfies z.ZodType<SerialRecord>;
const chunkRecordSchema = z.object({
  id: z.number(),
  generation: z.number(),
  sentenceId: sentenceIdSchema,
  label: z.string(),
  content: z.string(),
  sentenceIds: z.array(sentenceIdSchema),
  retention: z.enum(ChunkRetention).optional(),
  importance: z.enum(ChunkImportance).optional(),
  wordsCount: z.number(),
  weight: z.number(),
});
const knowledgeEdgeRecordSchema = z.object({
  fromId: z.number(),
  toId: z.number(),
  strength: z.string().optional(),
  weight: z.number(),
});
const snakeRecordSchema = z.object({
  id: z.number(),
  serialId: z.number(),
  groupId: z.number(),
  localSnakeId: z.number(),
  size: z.number(),
  firstLabel: z.string(),
  lastLabel: z.string(),
  wordsCount: z.number(),
  weight: z.number(),
}) satisfies z.ZodType<SnakeRecord>;
const snakeChunkRecordSchema = z.object({
  snakeId: z.number(),
  chunkId: z.number(),
  position: z.number(),
}) satisfies z.ZodType<SnakeChunkRecord>;
const snakeEdgeRecordSchema = z.object({
  fromSnakeId: z.number(),
  toSnakeId: z.number(),
  weight: z.number(),
}) satisfies z.ZodType<SnakeEdgeRecord>;
const fragmentGroupRecordSchema = z.object({
  serialId: z.number(),
  groupId: z.number(),
  startSentenceIndex: z.number(),
  endSentenceIndex: z.number(),
}) satisfies z.ZodType<SentenceGroupRecord>;

const summaryInputSnapshotSchema = z.object({
  chunks: z.array(chunkRecordSchema),
  fragmentGroups: z.array(fragmentGroupRecordSchema),
  fragments: z.array(fragmentRecordSchema),
  readingEdges: z.array(knowledgeEdgeRecordSchema),
  serial: serialRecordSchema,
  snakeChunks: z.array(snakeChunkRecordSchema),
  snakeEdges: z.array(snakeEdgeRecordSchema),
  snakes: z.array(snakeRecordSchema),
});

interface SummaryInputSnapshotData {
  readonly chunks: readonly ChunkRecord[];
  readonly fragmentGroups: readonly SentenceGroupRecord[];
  readonly fragments: readonly FragmentRecord[];
  readonly readingEdges: readonly ReadingEdgeRecord[];
  readonly serial: SerialRecord;
  readonly snakeChunks: readonly SnakeChunkRecord[];
  readonly snakeEdges: readonly SnakeEdgeRecord[];
  readonly snakes: readonly SnakeRecord[];
}

export async function readChapterBuildInput(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<{
  readonly details: ChapterDetails;
  readonly revision: number;
  readonly sourceText: readonly string[];
}> {
  const details = await getChapterDetails(document, chapterId);

  return {
    details,
    revision: await document.serials.getRevision(chapterId),
    sourceText: await collectReaderText(readChapterSource(document, chapterId)),
  };
}

export async function buildChapterGraphArtifact(
  chapterId: number,
  options: BuildChapterGraphArtifactOptions,
): Promise<ChapterGraphBuildArtifact> {
  const documentPath = join(options.workspacePath, "graph-document");

  await rm(documentPath, { force: true, recursive: true });
  await mkdir(options.workspacePath, { recursive: true });

  const document = await DirectoryDocument.open(documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.serials.createWithId(chapterId);
      await writeGraphArtifactSourceFragments(
        documentPath,
        chapterId,
        options.sourceText,
      );
      const artifactDocument = createFragmentBackedDocument(
        openedDocument,
        documentPath,
      );

      await new SerialGeneration({
        document: artifactDocument,
        llm: options.llm,
        ...(options.logDirPath === undefined
          ? {}
          : { logDirPath: options.logDirPath }),
      }).buildTopologyInto(
        chapterId,
        createTopologyOptions(options),
        options.progressTracker,
      );
    });
  } finally {
    await document.release();
  }

  return {
    chapterId,
    documentPath,
    parameter: createGraphBuildParameterInput(options),
  };
}

export async function commitChapterGraphArtifact(
  document: Document,
  artifact: ChapterGraphBuildArtifact,
): Promise<ChapterDetails> {
  const sourceDocument = await DirectoryDocument.open(artifact.documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await requireStage(openedDocument, artifact.chapterId, "sourced");
      await openedDocument.clearSerialGraph(artifact.chapterId);
      await openedDocument.serials.ensure(artifact.chapterId);

      const chunkIdMap = await copyChunks(
        sourceDocument,
        openedDocument,
        artifact.chapterId,
      );

      for (const edge of await sourceDocument.readingEdges.listBySerial(
        artifact.chapterId,
      )) {
        const fromId = chunkIdMap.get(edge.fromId);
        const toId = chunkIdMap.get(edge.toId);

        if (fromId === undefined || toId === undefined) {
          continue;
        }

        await openedDocument.readingEdges.save({
          ...edge,
          fromId,
          toId,
        });
      }

      await openedDocument.fragmentGroups.saveMany(
        await sourceDocument.fragmentGroups.listBySerial(artifact.chapterId),
      );
      await copySnakes(
        sourceDocument,
        openedDocument,
        artifact.chapterId,
        chunkIdMap,
      );
      const parameter = await openedDocument.graphBuildParameters.save(
        artifact.parameter,
      );
      await openedDocument.serials.setTopologyReady(
        artifact.chapterId,
        true,
        parameter.hash,
      );
    });

    return await getChapterDetails(document, artifact.chapterId);
  } finally {
    await sourceDocument.release();
  }
}

export async function buildChapterSummaryArtifact(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const snapshotPath = options.snapshotPath;

  if (snapshotPath !== undefined) {
    return await buildChapterSummaryArtifactFromSnapshot(chapterId, {
      ...options,
      snapshotPath,
    });
  }

  const sourceDocumentPath = options.sourceDocumentPath;

  if (sourceDocumentPath !== undefined) {
    return await buildChapterSummaryArtifactFromDocumentSnapshot(chapterId, {
      ...options,
      sourceDocumentPath,
    });
  }

  return await buildChapterSummaryArtifactFromDocument(
    document,
    chapterId,
    options,
  );
}

export async function buildChapterSummaryArtifactFromSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly snapshotPath: string;
  },
): Promise<string> {
  const snapshot = await readSummaryInputSnapshot(options.snapshotPath);
  return await buildSummaryFromSnapshot(snapshot, chapterId, options);
}

async function buildChapterSummaryArtifactFromDocumentSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly sourceDocumentPath: string;
  },
): Promise<string> {
  const document = await DirectoryDocument.open(options.sourceDocumentPath);

  try {
    return await buildChapterSummaryArtifactFromDocument(
      createFragmentBackedDocument(document, options.sourceDocumentPath),
      chapterId,
      options,
    );
  } finally {
    await document.release();
  }
}

async function buildChapterSummaryArtifactFromDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${chapterId} is ${details.stage}. Generate a summary only for graphed chapters.`,
    );
  }

  const summary = await document.readSummary(chapterId);

  if (summary !== undefined) {
    return summary;
  }

  return await buildSummaryFromDocument(document, chapterId, options);
}

export async function commitChapterSummaryArtifact(
  document: Document,
  chapterId: number,
  summary: string,
): Promise<ChapterDetails> {
  await document.openSession(async (openedDocument) => {
    await requireStage(openedDocument, chapterId, "graphed");
    await openedDocument.writeSummary(chapterId, summary);
  });

  return await getChapterDetails(document, chapterId);
}

export async function snapshotChapterSummaryInput(
  document: ReadonlyDocument,
  chapterId: number,
  workspacePath: string,
): Promise<ChapterSummaryInputSnapshot> {
  const filePath = join(workspacePath, "summary-input.json");

  await mkdir(workspacePath, { recursive: true });
  await requireStage(document, chapterId, "graphed");

  const fragments = await readSerialFragments(document, chapterId);
  const snakes = await document.snakes.listBySerial(chapterId);
  const snakeChunks = (
    await Promise.all(
      snakes.map(
        async (snake) => await document.snakeChunks.listBySnake(snake.id),
      ),
    )
  ).flat();

  await writeSummaryInputSnapshot(filePath, {
    chunks: await document.chunks.listBySerial(chapterId),
    fragmentGroups: await document.fragmentGroups.listBySerial(chapterId),
    fragments,
    readingEdges: await document.readingEdges.listBySerial(chapterId),
    serial: {
      documentOrder: chapterId,
      id: chapterId,
      knowledgeGraphReady: false,
      revision: 0,
      topologyReady: true,
    },
    snakeChunks,
    snakeEdges: await document.snakeEdges.listBySerial(chapterId),
    snakes,
  });

  return { filePath };
}

async function buildSummaryFromSnapshot(
  snapshot: SummaryInputSnapshotData,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  if (snapshot.serial.id !== chapterId) {
    throw new Error(
      `Summary snapshot belongs to chapter ${snapshot.serial.id}, not chapter ${chapterId}.`,
    );
  }
  if (!snapshot.serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  const document = new SummaryInputSnapshotDocument(snapshot);
  const fragments = document.getSerialFragments(chapterId);
  const sentenceStartIndexes = await fragments.listFragmentIds();

  if (sentenceStartIndexes.length <= 1) {
    return await readPassthroughSummary(fragments, sentenceStartIndexes);
  }

  const summaryParts: string[] = [];

  for (const groupId of await document.fragmentGroups.listGroupIdsForSerial(
    chapterId,
  )) {
    const groupSummary = await compressText({
      compressionRatio: 0.2,
      document,
      groupId,
      llm: options.llm,
      maxClues: 10,
      maxIterations: 5,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: chapterId,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    if (groupSummary.trim() === "") {
      continue;
    }
    summaryParts.push(groupSummary);
  }

  return summaryParts.join("\n\n");
}

async function buildSummaryFromDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const serial = await document.serials.getById(chapterId);

  if (serial === undefined) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
    );
  }
  if (!serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  const fragments = document.getSerialFragments(chapterId);
  const sentenceStartIndexes = await fragments.listFragmentIds();

  if (sentenceStartIndexes.length <= 1) {
    return await readPassthroughSummary(fragments, sentenceStartIndexes);
  }

  const summaryParts: string[] = [];

  for (const groupId of await document.fragmentGroups.listGroupIdsForSerial(
    chapterId,
  )) {
    const groupSummary = await compressText({
      compressionRatio: 0.2,
      document,
      groupId,
      llm: options.llm,
      maxClues: 10,
      maxIterations: 5,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: chapterId,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    if (groupSummary.trim() === "") {
      continue;
    }
    summaryParts.push(groupSummary);
  }

  return summaryParts.join("\n\n");
}

async function readPassthroughSummary(
  fragments: ReadonlySerialFragments,
  sentenceStartIndexes: readonly number[],
): Promise<string> {
  if (sentenceStartIndexes.length === 0) {
    return "";
  }

  const records = await Promise.all(
    sentenceStartIndexes.map(
      async (startSentenceIndex) =>
        await fragments.getFragment(startSentenceIndex),
    ),
  );

  return records
    .flatMap((fragment) => fragment.sentences.map((sentence) => sentence.text))
    .join(" ")
    .trim();
}

async function writeGraphArtifactSourceFragments(
  documentPath: string,
  chapterId: number,
  sourceText: ReaderTextStream,
): Promise<void> {
  const fragments = new Fragments(documentPath);
  const serial = fragments.getSerial(chapterId);
  let draft = await serial.createDraft();
  let draftWordsCount = 0;
  let hasSentences = false;

  await fragments.ensureCreated();

  for await (const sentence of segmentTextStream(sourceText)) {
    const text = sentence.text.trim();

    if (text === "") {
      continue;
    }
    if (
      draftWordsCount > 0 &&
      draftWordsCount + sentence.wordsCount >
        GRAPH_ARTIFACT_FRAGMENT_WORDS_COUNT
    ) {
      await draft.commit();
      draft = await serial.createDraft();
      draftWordsCount = 0;
    }

    draft.addSentence(text, sentence.wordsCount);
    draftWordsCount += sentence.wordsCount;
    hasSentences = true;
  }

  if (hasSentences) {
    await draft.commit();
  } else {
    draft.discard();
  }
}

function createFragmentBackedDocument<TDocument extends ReadonlyDocument>(
  document: TDocument,
  documentPath: string,
): TDocument {
  const fragments = new Fragments(documentPath);

  return new Proxy(document, {
    get(target, property, receiver): unknown {
      if (property === "getSerialFragments") {
        return (serialId: number) => fragments.getSerial(serialId);
      }
      if (property === "getSummaryFragments") {
        return (serialId: number) => fragments.getSummarySerial(serialId);
      }
      if (property === "getSentence") {
        return async (sentenceId: SentenceId) =>
          await fragments.getSentence(sentenceId);
      }

      const value = Reflect.get(target, property, receiver) as unknown;

      if (typeof value !== "function") {
        return value;
      }

      return value.bind(target) as unknown;
    },
  });
}

async function readSerialFragments(
  document: ReadonlyDocument,
  serialId: number,
): Promise<readonly FragmentRecord[]> {
  const fragments = document.getSerialFragments(serialId);

  return await Promise.all(
    (await fragments.listFragmentIds()).map(
      async (fragmentId) => await fragments.getFragment(fragmentId),
    ),
  );
}

async function readSummaryInputSnapshot(
  filePath: string,
): Promise<SummaryInputSnapshotData> {
  const snapshot = summaryInputSnapshotSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );

  return {
    ...snapshot,
    chunks: snapshot.chunks.map(toChunkRecord),
    readingEdges: snapshot.readingEdges.map(toReadingEdgeRecord),
  };
}

function toChunkRecord(record: z.infer<typeof chunkRecordSchema>): ChunkRecord {
  return {
    id: record.id,
    generation: record.generation,
    sentenceId: record.sentenceId,
    label: record.label,
    content: record.content,
    sentenceIds: record.sentenceIds,
    ...(record.retention === undefined ? {} : { retention: record.retention }),
    ...(record.importance === undefined
      ? {}
      : { importance: record.importance }),
    wordsCount: record.wordsCount,
    weight: record.weight,
  };
}

function toReadingEdgeRecord(
  record: z.infer<typeof knowledgeEdgeRecordSchema>,
): ReadingEdgeRecord {
  return {
    fromId: record.fromId,
    toId: record.toId,
    ...(record.strength === undefined ? {} : { strength: record.strength }),
    weight: record.weight,
  };
}

async function writeSummaryInputSnapshot(
  filePath: string,
  snapshot: SummaryInputSnapshotData,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
}

class SummaryInputSnapshotDocument implements ReadonlyDocument {
  public readonly chunks: ReadonlyChunkStore;
  public readonly fragmentGroups: ReadonlyFragmentGroupStore;
  public readonly graphBuildParameters: ReadonlyGraphBuildParameterStore;
  public readonly readingEdges: ReadonlyReadingEdgeStore;
  public readonly mentionLinks: ReadonlyMentionLinkStore;
  public readonly mentions: ReadonlyMentionStore;
  public readonly metadata: ReadonlyObjectMetadataStore;
  public readonly serials: ReadonlySerialStore;
  public readonly snakeChunks: ReadonlySnakeChunkStore;
  public readonly snakeEdges: ReadonlySnakeEdgeStore;
  public readonly snakes: ReadonlySnakeStore;
  readonly #fragments: ReadonlySerialFragments;

  public constructor(snapshot: SummaryInputSnapshotData) {
    const serialId = snapshot.serial.id;

    this.chunks = new SnapshotChunkStore(snapshot.chunks, snapshot.fragments);
    this.fragmentGroups = new SnapshotFragmentGroupStore(
      snapshot.fragmentGroups,
    );
    this.graphBuildParameters = new EmptySnapshotGraphBuildParameterStore();
    this.readingEdges = new SnapshotReadingEdgeStore(
      snapshot.readingEdges,
      snapshot.chunks,
    );
    this.mentionLinks = new EmptySnapshotMentionLinkStore();
    this.mentions = new EmptySnapshotMentionStore();
    this.metadata = new EmptySnapshotObjectMetadataStore();
    this.serials = new SnapshotSerialStore(snapshot.serial);
    this.snakeChunks = new SnapshotSnakeChunkStore(snapshot.snakeChunks);
    this.snakeEdges = new SnapshotSnakeEdgeStore(
      snapshot.snakeEdges,
      snapshot.snakes,
    );
    this.snakes = new SnapshotSnakeStore(snapshot.snakes);
    this.#fragments = new SnapshotSerialFragments(serialId, snapshot.fragments);
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [serialId, sentenceIndex] = sentenceId;
    const sentence = (await this.getSerialFragments(serialId).listSentences!())[
      sentenceIndex
    ];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence.text;
  }

  public getSerialFragments(serialId: number): ReadonlySerialFragments {
    if (serialId !== this.#fragments.serialId) {
      return new SnapshotSerialFragments(serialId, []);
    }
    return this.#fragments;
  }

  public getSummaryFragments(serialId: number): ReadonlySerialFragments {
    return new SnapshotSerialFragments(serialId, []);
  }

  public async openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T> {
    return await operation(this);
  }

  public readDatabase<T>(): Promise<T> {
    return Promise.reject(
      new Error("Summary input snapshots do not expose a SQLite database."),
    );
  }

  public readSearchIndexDatabase<T>(): Promise<T> {
    return Promise.reject(
      new Error(
        "Summary input snapshots do not expose a search index database.",
      ),
    );
  }

  public readBookMeta(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readCover(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readSummary(_serialId: number): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readToc(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public release(): Promise<void> {
    return Promise.resolve();
  }
}

class EmptySnapshotMentionStore implements ReadonlyMentionStore {
  public getById(_mentionId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listAll(): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByQid(_qid: string): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listBySurfaceTerms(
    _terms: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listBySurfaces(
    _surfaces: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }
}

class EmptySnapshotMentionLinkStore implements ReadonlyMentionLinkStore {
  public getById(_linkId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listByTriple(_input: {
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }
}

class EmptySnapshotObjectMetadataStore implements ReadonlyObjectMetadataStore {
  public getMap(
    _objectPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    return Promise.resolve({});
  }
}

class EmptySnapshotGraphBuildParameterStore implements ReadonlyGraphBuildParameterStore {
  public getByHash(_hash: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

class SnapshotSerialStore implements ReadonlySerialStore {
  readonly #serial: SerialRecord;

  public constructor(serial: SerialRecord) {
    this.#serial = serial;
  }

  public getById(serialId: number): Promise<SerialRecord | undefined> {
    return Promise.resolve(
      serialId === this.#serial.id ? this.#serial : undefined,
    );
  }

  public getRevision(serialId: number): Promise<number> {
    return Promise.resolve(
      serialId === this.#serial.id ? this.#serial.revision : 0,
    );
  }

  public getRevisions(
    serialIds: readonly number[],
  ): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(
      new Map(
        serialIds
          .filter((serialId) => serialId === this.#serial.id)
          .map((serialId) => [serialId, this.#serial.revision] as const),
      ),
    );
  }

  public getChaptersRevision(): Promise<number> {
    return Promise.resolve(this.#serial.revision);
  }

  public getMaxId(): Promise<number> {
    return Promise.resolve(this.#serial.id);
  }

  public listIds(): Promise<number[]> {
    return Promise.resolve([this.#serial.id]);
  }

  public listDocumentOrders(): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(
      new Map([[this.#serial.id, this.#serial.documentOrder]]),
    );
  }
}

class SnapshotSerialFragments implements ReadonlySerialFragments {
  public readonly path = "";
  public readonly serialId: number;
  readonly #fragmentsById: Map<number, FragmentRecord>;

  public constructor(serialId: number, fragments: readonly FragmentRecord[]) {
    this.serialId = serialId;
    this.#fragmentsById = new Map(
      fragments
        .filter((fragment) => fragment.serialId === serialId)
        .map((fragment) => [fragment.fragmentId, fragment]),
    );
  }

  public getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fragment = this.#fragmentsById.get(fragmentId);

    if (fragment === undefined) {
      throw new Error(`Fragment ${fragmentId} does not exist`);
    }

    return Promise.resolve(fragment);
  }

  public listFragmentIds(): Promise<readonly number[]> {
    return Promise.resolve([...this.#fragmentsById.keys()].sort(compareNumber));
  }

  public async getSentence(sentenceIndex: number) {
    const sentence = (await this.listSentences())[sentenceIndex];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence;
  }

  public async listSentencesInRange(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ) {
    return (await this.listSentences()).slice(
      startSentenceIndex,
      endSentenceIndex + 1,
    );
  }

  public async listSentences() {
    const fragments = await Promise.all(
      (await this.listFragmentIds()).map(
        async (fragmentId) => await this.getFragment(fragmentId),
      ),
    );

    return fragments.flatMap((fragment) => fragment.sentences);
  }

  public async readText(): Promise<string | undefined> {
    const sentences = await this.listSentences();

    if (sentences.length === 0) {
      return undefined;
    }

    return sentences.map((sentence) => sentence.text).join("");
  }
}

class SnapshotChunkStore implements ReadonlyChunkStore {
  readonly #chunks: readonly ChunkRecord[];
  readonly #chunksById: Map<number, ChunkRecord>;
  readonly #fragmentStartIndexesBySerialId: ReadonlyMap<
    number,
    readonly number[]
  >;

  public constructor(
    chunks: readonly ChunkRecord[],
    fragments: readonly FragmentRecord[],
  ) {
    this.#chunks = [...chunks].sort(compareChunkById);
    this.#chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    this.#fragmentStartIndexesBySerialId =
      createFragmentStartIndexesBySerialId(fragments);
  }

  public getById(chunkId: number): Promise<ChunkRecord | undefined> {
    return Promise.resolve(this.#chunksById.get(chunkId));
  }

  public countAll(): Promise<number> {
    return Promise.resolve(this.#chunks.length);
  }

  public listAll(): Promise<ChunkRecord[]> {
    return Promise.resolve([...this.#chunks]);
  }

  public listBySentenceStartIndexes(
    serialId: number,
    sentenceStartIndexes: readonly number[],
  ): Promise<ChunkRecord[]> {
    const segmentRanges = createSegmentRanges(
      this.#fragmentStartIndexesBySerialId.get(serialId) ?? [],
      sentenceStartIndexes,
    );

    return Promise.resolve(
      this.#chunks.filter(
        (chunk) =>
          chunk.sentenceId[0] === serialId &&
          segmentRanges.some(
            (range) =>
              chunk.sentenceId[1] >= range.startSentenceIndex &&
              chunk.sentenceId[1] <= range.endSentenceIndex,
          ),
      ),
    );
  }

  public listBySentenceRange(
    serialId: number,
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<ChunkRecord[]> {
    return Promise.resolve(
      this.#chunks.filter(
        (chunk) =>
          chunk.sentenceId[0] === serialId &&
          chunk.sentenceId[1] >= startSentenceIndex &&
          chunk.sentenceId[1] <= endSentenceIndex,
      ),
    );
  }

  public listBySerial(serialId: number): Promise<ChunkRecord[]> {
    return Promise.resolve(
      this.#chunks.filter((chunk) => chunk.sentenceId[0] === serialId),
    );
  }

  public getMaxId(): Promise<number> {
    return Promise.resolve(
      this.#chunks.reduce((maxId, chunk) => Math.max(maxId, chunk.id), 0),
    );
  }

  public listFragmentPairs(): Promise<
    ReadonlyArray<readonly [number, number]>
  > {
    const pairs = new Set<string>();

    for (const chunk of this.#chunks) {
      pairs.add(`${chunk.sentenceId[0]}:${chunk.sentenceId[1]}`);
    }

    return Promise.resolve(
      [...pairs]
        .map((pair) => pair.split(":").map(Number) as [number, number])
        .sort(comparePair)
        .map(([serialId, fragmentId]) => [serialId, fragmentId] as const),
    );
  }
}

class SnapshotReadingEdgeStore implements ReadonlyReadingEdgeStore {
  readonly #edges: readonly ReadingEdgeRecord[];
  readonly #serialIdByChunkId: Map<number, number>;

  public constructor(
    edges: readonly ReadingEdgeRecord[],
    chunks: readonly ChunkRecord[],
  ) {
    this.#edges = [...edges].sort(compareReadingEdge);
    this.#serialIdByChunkId = new Map(
      chunks.map((chunk) => [chunk.id, chunk.sentenceId[0]]),
    );
  }

  public listAll(): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve([...this.#edges]);
  }

  public countAll(): Promise<number> {
    return Promise.resolve(this.#edges.length);
  }

  public listBySerial(serialId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          this.#serialIdByChunkId.get(edge.fromId) === serialId &&
          this.#serialIdByChunkId.get(edge.toId) === serialId,
      ),
    );
  }

  public listIncoming(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(this.#edges.filter((edge) => edge.toId === chunkId));
  }

  public listOutgoing(chunkId: number): Promise<ReadingEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.fromId === chunkId),
    );
  }
}

class SnapshotSnakeStore implements ReadonlySnakeStore {
  readonly #snakes: readonly SnakeRecord[];
  readonly #snakesById: Map<number, SnakeRecord>;

  public constructor(snakes: readonly SnakeRecord[]) {
    this.#snakes = [...snakes].sort(compareSnake);
    this.#snakesById = new Map(snakes.map((snake) => [snake.id, snake]));
  }

  public getById(snakeId: number): Promise<SnakeRecord | undefined> {
    return Promise.resolve(this.#snakesById.get(snakeId));
  }

  public listIdsByGroup(serialId: number, groupId: number): Promise<number[]> {
    return Promise.resolve(
      this.#snakes
        .filter(
          (snake) => snake.serialId === serialId && snake.groupId === groupId,
        )
        .map((snake) => snake.id)
        .sort(compareNumber),
    );
  }

  public listBySerial(serialId: number): Promise<SnakeRecord[]> {
    return Promise.resolve(
      this.#snakes.filter((snake) => snake.serialId === serialId),
    );
  }
}

class SnapshotSnakeChunkStore implements ReadonlySnakeChunkStore {
  readonly #snakeChunks: readonly SnakeChunkRecord[];

  public constructor(snakeChunks: readonly SnakeChunkRecord[]) {
    this.#snakeChunks = [...snakeChunks].sort(compareSnakeChunk);
  }

  public listChunkIds(snakeId: number): Promise<number[]> {
    return Promise.resolve(
      this.#snakeChunks
        .filter((snakeChunk) => snakeChunk.snakeId === snakeId)
        .map((snakeChunk) => snakeChunk.chunkId),
    );
  }

  public listBySnake(snakeId: number): Promise<SnakeChunkRecord[]> {
    return Promise.resolve(
      this.#snakeChunks.filter((snakeChunk) => snakeChunk.snakeId === snakeId),
    );
  }
}

class SnapshotSnakeEdgeStore implements ReadonlySnakeEdgeStore {
  readonly #edges: readonly SnakeEdgeRecord[];
  readonly #serialIdBySnakeId: Map<number, number>;

  public constructor(
    edges: readonly SnakeEdgeRecord[],
    snakes: readonly SnakeRecord[],
  ) {
    this.#edges = [...edges].sort(compareSnakeEdge);
    this.#serialIdBySnakeId = new Map(
      snakes.map((snake) => [snake.id, snake.serialId]),
    );
  }

  public listIncoming(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.toSnakeId === snakeId),
    );
  }

  public listOutgoing(snakeId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter((edge) => edge.fromSnakeId === snakeId),
    );
  }

  public listWithin(snakeIds: readonly number[]): Promise<SnakeEdgeRecord[]> {
    const snakeIdSet = new Set(snakeIds);

    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          snakeIdSet.has(edge.fromSnakeId) && snakeIdSet.has(edge.toSnakeId),
      ),
    );
  }

  public listBySerial(serialId: number): Promise<SnakeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          this.#serialIdBySnakeId.get(edge.fromSnakeId) === serialId &&
          this.#serialIdBySnakeId.get(edge.toSnakeId) === serialId,
      ),
    );
  }
}

class SnapshotFragmentGroupStore implements ReadonlyFragmentGroupStore {
  readonly #groups: readonly SentenceGroupRecord[];

  public constructor(groups: readonly SentenceGroupRecord[]) {
    this.#groups = [...groups].sort(compareFragmentGroup);
  }

  public listBySerial(serialId: number): Promise<SentenceGroupRecord[]> {
    return Promise.resolve(
      this.#groups.filter((group) => group.serialId === serialId),
    );
  }

  public listSerialIds(): Promise<number[]> {
    return Promise.resolve(
      [...new Set(this.#groups.map((group) => group.serialId))].sort(
        compareNumber,
      ),
    );
  }

  public listGroupIdsForSerial(serialId: number): Promise<number[]> {
    return Promise.resolve(
      [
        ...new Set(
          this.#groups
            .filter((group) => group.serialId === serialId)
            .map((group) => group.groupId),
        ),
      ].sort(compareNumber),
    );
  }
}

async function copySnakes(
  sourceDocument: ReadonlyDocument,
  targetDocument: Document,
  serialId: number,
  chunkIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  const sourceSnakes = await sourceDocument.snakes.listBySerial(serialId);
  const snakeIdMap = new Map<number, number>();

  for (const sourceSnake of sourceSnakes) {
    const targetSnakeId = await targetDocument.snakes.create({
      firstLabel: sourceSnake.firstLabel,
      groupId: sourceSnake.groupId,
      lastLabel: sourceSnake.lastLabel,
      localSnakeId: sourceSnake.localSnakeId,
      serialId,
      size: sourceSnake.size,
      weight: sourceSnake.weight,
      wordsCount: sourceSnake.wordsCount,
    });

    snakeIdMap.set(sourceSnake.id, targetSnakeId);

    for (const snakeChunk of await sourceDocument.snakeChunks.listBySnake(
      sourceSnake.id,
    )) {
      const chunkId = chunkIdMap.get(snakeChunk.chunkId);

      if (chunkId === undefined) {
        continue;
      }

      await targetDocument.snakeChunks.save({
        chunkId,
        position: snakeChunk.position,
        snakeId: targetSnakeId,
      });
    }
  }

  for (const edge of await sourceDocument.snakeEdges.listBySerial(serialId)) {
    const fromSnakeId = snakeIdMap.get(edge.fromSnakeId);
    const toSnakeId = snakeIdMap.get(edge.toSnakeId);

    if (fromSnakeId === undefined || toSnakeId === undefined) {
      continue;
    }

    await targetDocument.snakeEdges.save({
      fromSnakeId,
      toSnakeId,
      weight: edge.weight,
    });
  }
}

async function copyChunks(
  sourceDocument: ReadonlyDocument,
  targetDocument: Document,
  serialId: number,
): Promise<ReadonlyMap<number, number>> {
  const chunkIdMap = new Map<number, number>();

  for (const chunk of await sourceDocument.chunks.listBySerial(serialId)) {
    const createdChunk = await targetDocument.chunks.create({
      content: chunk.content,
      generation: chunk.generation,
      label: chunk.label,
      sentenceId: chunk.sentenceId,
      sentenceIds: chunk.sentenceIds,
      weight: chunk.weight,
      wordsCount: chunk.wordsCount,
      ...(chunk.importance === undefined
        ? {}
        : { importance: chunk.importance }),
      ...(chunk.retention === undefined ? {} : { retention: chunk.retention }),
    });

    chunkIdMap.set(chunk.id, createdChunk.id);
  }

  return chunkIdMap;
}

async function requireStage(
  document: ReadonlyDocument,
  chapterId: number,
  stage: ChapterDetails["stage"],
): Promise<void> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage !== stage) {
    throw new Error(
      `Chapter ${chapterId} is ${details.stage}. Expected ${stage} before committing build output.`,
    );
  }
}

function createTopologyOptions(
  options: Pick<
    BuildSerialTopologyOptions,
    "extractionPrompt" | "userLanguage"
  >,
): BuildSerialTopologyOptions {
  return {
    extractionPrompt: options.extractionPrompt,
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  };
}

function createGraphBuildParameterInput(
  options: Pick<
    BuildSerialTopologyOptions,
    "extractionPrompt" | "userLanguage"
  >,
): GraphBuildParameterInput {
  const language = normalizeLanguageCode(options.userLanguage);

  return {
    ...(language === undefined ? {} : { language }),
    prompt: options.extractionPrompt,
  };
}

async function* readChapterSource(
  document: ReadonlyDocument,
  chapterId: number,
): ReaderTextStream {
  const fragments = document.getSerialFragments(chapterId);

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (const sentence of fragment.sentences) {
      yield sentence.text;
    }
  }
}

async function collectReaderText(
  stream: ReaderTextStream,
): Promise<readonly string[]> {
  const text: string[] = [];

  for await (const chunk of stream) {
    text.push(chunk);
  }

  return text;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createFragmentStartIndexesBySerialId(
  fragments: readonly FragmentRecord[],
): ReadonlyMap<number, readonly number[]> {
  const indexesBySerialId = new Map<number, number[]>();

  for (const fragment of fragments) {
    const indexes = indexesBySerialId.get(fragment.serialId) ?? [];

    indexes.push(fragment.fragmentId);
    indexesBySerialId.set(fragment.serialId, indexes);
  }

  return new Map(
    [...indexesBySerialId.entries()].map(
      ([serialId, indexes]) => [serialId, indexes.sort(compareNumber)] as const,
    ),
  );
}

function createSegmentRanges(
  allStartIndexes: readonly number[],
  selectedStartIndexes: readonly number[],
): Array<{
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
}> {
  const selected = new Set(selectedStartIndexes);

  return allStartIndexes.flatMap((startSentenceIndex, index) => {
    if (!selected.has(startSentenceIndex)) {
      return [];
    }

    const nextStartSentenceIndex = allStartIndexes[index + 1];

    return [
      {
        endSentenceIndex:
          nextStartSentenceIndex === undefined
            ? Infinity
            : nextStartSentenceIndex - 1,
        startSentenceIndex,
      },
    ];
  });
}

function compareChunkById(left: ChunkRecord, right: ChunkRecord): number {
  return left.id - right.id;
}

function compareFragmentGroup(
  left: SentenceGroupRecord,
  right: SentenceGroupRecord,
): number {
  return (
    left.serialId - right.serialId ||
    left.groupId - right.groupId ||
    left.startSentenceIndex - right.startSentenceIndex ||
    left.endSentenceIndex - right.endSentenceIndex
  );
}

function compareReadingEdge(
  left: ReadingEdgeRecord,
  right: ReadingEdgeRecord,
): number {
  return left.fromId - right.fromId || left.toId - right.toId;
}

function comparePair(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] - right[0] || left[1] - right[1];
}

function compareSnake(left: SnakeRecord, right: SnakeRecord): number {
  return left.groupId - right.groupId || left.id - right.id;
}

function compareSnakeChunk(
  left: SnakeChunkRecord,
  right: SnakeChunkRecord,
): number {
  return left.snakeId - right.snakeId || left.position - right.position;
}

function compareSnakeEdge(
  left: SnakeEdgeRecord,
  right: SnakeEdgeRecord,
): number {
  return (
    left.fromSnakeId - right.fromSnakeId || left.toSnakeId - right.toSnakeId
  );
}
