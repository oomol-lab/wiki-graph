import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";

import type {
  ChunkRecord,
  Document,
  FragmentGroupRecord,
  FragmentRecord,
  KnowledgeEdgeRecord,
  ReadonlyChunkStore,
  ReadonlyDocument,
  ReadonlyFragmentGroupStore,
  ReadonlyKnowledgeEdgeStore,
  ReadonlySerialFragments,
  ReadonlySerialStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
  SentenceId,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../document/index.js";
import { DirectoryDocument } from "../document/index.js";
import { SPINE_DIGEST_EDITOR_SCOPES } from "../common/llm-scope.js";
import { compressText } from "../editor/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import {
  SerialGeneration,
  type BuildSerialTopologyOptions,
} from "../serial.js";

import {
  getChapterDetails,
  type ChapterDetails,
  type GenerateChapterGraphOptions,
  type GenerateChapterSummaryOptions,
} from "./chapter.js";

export interface ChapterGraphBuildArtifact {
  readonly documentPath: string;
  readonly chapterId: number;
}

export interface ChapterSummaryInputSnapshot {
  readonly filePath: string;
}

export interface BuildChapterGraphArtifactOptions extends GenerateChapterGraphOptions {
  readonly sourceText: readonly string[];
  readonly nextChunkId: number;
  readonly workspacePath: string;
}

export interface BuildChapterSummaryArtifactOptions extends GenerateChapterSummaryOptions {
  readonly snapshotPath?: string;
  readonly sourceDocumentPath?: string;
  readonly workspacePath: string;
}

const summaryInputSnapshotSchema = z.object({
  chunks: z.array(z.custom<ChunkRecord>()),
  fragmentGroups: z.array(z.custom<FragmentGroupRecord>()),
  fragments: z.array(z.custom<FragmentRecord>()),
  knowledgeEdges: z.array(z.custom<KnowledgeEdgeRecord>()),
  serial: z.custom<SerialRecord>(),
  snakeChunks: z.array(z.custom<SnakeChunkRecord>()),
  snakeEdges: z.array(z.custom<SnakeEdgeRecord>()),
  snakes: z.array(z.custom<SnakeRecord>()),
});

interface SummaryInputSnapshotData {
  readonly chunks: readonly ChunkRecord[];
  readonly fragmentGroups: readonly FragmentGroupRecord[];
  readonly fragments: readonly FragmentRecord[];
  readonly knowledgeEdges: readonly KnowledgeEdgeRecord[];
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
  readonly nextChunkId: number;
  readonly sourceText: readonly string[];
}> {
  const details = await getChapterDetails(document, chapterId);

  return {
    details,
    nextChunkId: (await document.chunks.getMaxId()) + 1,
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
      await new SerialGeneration({
        document: openedDocument,
        llm: options.llm,
        ...(options.logDirPath === undefined
          ? {}
          : { logDirPath: options.logDirPath }),
        nextChunkId: options.nextChunkId,
      }).buildTopologyInto(
        chapterId,
        options.sourceText,
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
      await openedDocument.clearSerialSource(artifact.chapterId);
      await openedDocument.serials.ensure(artifact.chapterId);
      await copySerialFragments(
        sourceDocument,
        openedDocument,
        artifact.chapterId,
      );

      for (const chunk of await sourceDocument.chunks.listBySerial(
        artifact.chapterId,
      )) {
        await openedDocument.chunks.save(chunk);
      }

      for (const edge of await sourceDocument.knowledgeEdges.listBySerial(
        artifact.chapterId,
      )) {
        await openedDocument.knowledgeEdges.save(edge);
      }

      await openedDocument.fragmentGroups.saveMany(
        await sourceDocument.fragmentGroups.listBySerial(artifact.chapterId),
      );
      await copySnakes(sourceDocument, openedDocument, artifact.chapterId);
      await openedDocument.serials.setTopologyReady(artifact.chapterId);
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
      document,
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
    knowledgeEdges: await document.knowledgeEdges.listBySerial(chapterId),
    serial: { id: chapterId, topologyReady: true },
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
  const fragmentIds = await fragments.listFragmentIds();

  if (fragmentIds.length <= 1) {
    return await readPassthroughSummary(fragments, fragmentIds);
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
      scopes: SPINE_DIGEST_EDITOR_SCOPES,
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
      `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
    );
  }
  if (!serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  const fragments = document.getSerialFragments(chapterId);
  const fragmentIds = await fragments.listFragmentIds();

  if (fragmentIds.length <= 1) {
    return await readPassthroughSummary(fragments, fragmentIds);
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
      scopes: SPINE_DIGEST_EDITOR_SCOPES,
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
    .flatMap((fragment) => fragment.sentences.map((sentence) => sentence.text))
    .join(" ")
    .trim();
}

async function copySerialFragments(
  sourceDocument: ReadonlyDocument,
  targetDocument: Document,
  serialId: number,
): Promise<void> {
  const sourceFragments = sourceDocument.getSerialFragments(serialId);
  const targetFragments = targetDocument.getSerialFragments(serialId);

  for (const fragmentId of await sourceFragments.listFragmentIds()) {
    const fragment = await sourceFragments.getFragment(fragmentId);
    const draft = await targetFragments.createDraft();

    for (const sentence of fragment.sentences) {
      draft.addSentence(sentence.text, sentence.wordsCount);
    }
    draft.setSummary(fragment.summary);
    await draft.commit();
  }
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
  return summaryInputSnapshotSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
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
  public readonly knowledgeEdges: ReadonlyKnowledgeEdgeStore;
  public readonly serials: ReadonlySerialStore;
  public readonly snakeChunks: ReadonlySnakeChunkStore;
  public readonly snakeEdges: ReadonlySnakeEdgeStore;
  public readonly snakes: ReadonlySnakeStore;
  readonly #fragments: ReadonlySerialFragments;

  public constructor(snapshot: SummaryInputSnapshotData) {
    const serialId = snapshot.serial.id;

    this.chunks = new SnapshotChunkStore(snapshot.chunks);
    this.fragmentGroups = new SnapshotFragmentGroupStore(
      snapshot.fragmentGroups,
    );
    this.knowledgeEdges = new SnapshotKnowledgeEdgeStore(
      snapshot.knowledgeEdges,
      snapshot.chunks,
    );
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
    const [serialId, fragmentId, sentenceIndex] = sentenceId;
    const fragment =
      await this.getSerialFragments(serialId).getFragment(fragmentId);
    const sentence = fragment.sentences[sentenceIndex];

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

  public async openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T> {
    return await operation(this);
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

  public getMaxId(): Promise<number> {
    return Promise.resolve(this.#serial.id);
  }

  public listIds(): Promise<number[]> {
    return Promise.resolve([this.#serial.id]);
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
}

class SnapshotChunkStore implements ReadonlyChunkStore {
  readonly #chunks: readonly ChunkRecord[];
  readonly #chunksById: Map<number, ChunkRecord>;

  public constructor(chunks: readonly ChunkRecord[]) {
    this.#chunks = [...chunks].sort(compareChunkById);
    this.#chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  }

  public getById(chunkId: number): Promise<ChunkRecord | undefined> {
    return Promise.resolve(this.#chunksById.get(chunkId));
  }

  public listAll(): Promise<ChunkRecord[]> {
    return Promise.resolve([...this.#chunks]);
  }

  public listByFragments(
    serialId: number,
    fragmentIds: readonly number[],
  ): Promise<ChunkRecord[]> {
    const fragmentIdSet = new Set(fragmentIds);

    return Promise.resolve(
      this.#chunks.filter(
        (chunk) =>
          chunk.sentenceId[0] === serialId &&
          fragmentIdSet.has(chunk.sentenceId[1]),
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

class SnapshotKnowledgeEdgeStore implements ReadonlyKnowledgeEdgeStore {
  readonly #edges: readonly KnowledgeEdgeRecord[];
  readonly #serialIdByChunkId: Map<number, number>;

  public constructor(
    edges: readonly KnowledgeEdgeRecord[],
    chunks: readonly ChunkRecord[],
  ) {
    this.#edges = [...edges].sort(compareKnowledgeEdge);
    this.#serialIdByChunkId = new Map(
      chunks.map((chunk) => [chunk.id, chunk.sentenceId[0]]),
    );
  }

  public listAll(): Promise<KnowledgeEdgeRecord[]> {
    return Promise.resolve([...this.#edges]);
  }

  public listBySerial(serialId: number): Promise<KnowledgeEdgeRecord[]> {
    return Promise.resolve(
      this.#edges.filter(
        (edge) =>
          this.#serialIdByChunkId.get(edge.fromId) === serialId &&
          this.#serialIdByChunkId.get(edge.toId) === serialId,
      ),
    );
  }

  public listIncoming(chunkId: number): Promise<KnowledgeEdgeRecord[]> {
    return Promise.resolve(this.#edges.filter((edge) => edge.toId === chunkId));
  }

  public listOutgoing(chunkId: number): Promise<KnowledgeEdgeRecord[]> {
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
  readonly #groups: readonly FragmentGroupRecord[];

  public constructor(groups: readonly FragmentGroupRecord[]) {
    this.#groups = [...groups].sort(compareFragmentGroup);
  }

  public listBySerial(serialId: number): Promise<FragmentGroupRecord[]> {
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
      await targetDocument.snakeChunks.save({
        chunkId: snakeChunk.chunkId,
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

function compareChunkById(left: ChunkRecord, right: ChunkRecord): number {
  return left.id - right.id;
}

function compareFragmentGroup(
  left: FragmentGroupRecord,
  right: FragmentGroupRecord,
): number {
  return (
    left.serialId - right.serialId ||
    left.groupId - right.groupId ||
    left.fragmentId - right.fragmentId
  );
}

function compareKnowledgeEdge(
  left: KnowledgeEdgeRecord,
  right: KnowledgeEdgeRecord,
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
