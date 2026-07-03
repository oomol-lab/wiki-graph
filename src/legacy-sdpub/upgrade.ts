import { createWriteStream } from "fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, posix, resolve, sep } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";

import { Database, type SqlBindValue } from "../document/database.js";
import { DirectoryDocument } from "../document/document.js";
import { rebuildArchiveSearchIndex } from "../archive/query/index.js";
import { writeWikgArchive } from "../wikg/index.js";
import { isNodeError } from "../utils/node-error.js";

const LEGACY_SDPUB_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^book-meta\.json$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^summaries\/serial-\d+\.txt$/u,
  /^fragments\/serial-\d+\/fragment_\d+\.json$/u,
] as const;
const LEGACY_FORMAT_VERSION = 1;

export interface LegacySdpubMigrationResult {
  readonly inputPath: string;
  readonly outputPath: string;
}

export async function migrateLegacySdpubToWikg(
  inputPath: string,
  outputPath = defaultWikgOutputPath(inputPath),
): Promise<LegacySdpubMigrationResult> {
  if (resolve(inputPath) === resolve(outputPath)) {
    throw new Error(
      "Legacy migration output path must differ from input path.",
    );
  }

  const workspacePath = await mkdtemp(join(tmpdir(), "wikigraph-sdpub-"));

  try {
    await extractLegacySdpubArchive(inputPath, workspacePath);
    await migrateKnowledgeEdgesInDatabase(join(workspacePath, "database.db"));
    await migrateLegacyTextStorage(workspacePath);
    await rebuildDerivedData(workspacePath);
    await writeWikgArchive(workspacePath, outputPath);

    return { inputPath, outputPath };
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

async function rebuildDerivedData(workspacePath: string): Promise<void> {
  const document = await DirectoryDocument.open(workspacePath);

  try {
    await rebuildArchiveSearchIndex(document);
  } finally {
    await document.release();
  }
}

function defaultWikgOutputPath(inputPath: string): string {
  if (inputPath.toLowerCase().endsWith(".sdpub")) {
    return `${inputPath.slice(0, -".sdpub".length)}.wikg`;
  }

  return `${inputPath}.wikg`;
}

async function extractLegacySdpubArchive(
  inputPath: string,
  outputDirectoryPath: string,
): Promise<void> {
  const zipFile = await openArchive(inputPath);

  try {
    const entries = await indexArchiveEntries(zipFile);

    await assertLegacySdpubArchive(zipFile, entries);
    for (const entry of entries) {
      const archivePath = normalizeArchivePath(entry.fileName);

      if (archivePath === "" || !isLegacySdpubPath(archivePath)) {
        continue;
      }

      const targetPath = resolve(outputDirectoryPath, archivePath);

      assertWithinDirectory(outputDirectoryPath, targetPath, archivePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await pipeline(
        await openArchiveEntryStream(zipFile, entry),
        createWriteStream(targetPath),
      );
    }
  } finally {
    zipFile.close();
  }
}

async function assertLegacySdpubArchive(
  zipFile: YauzlZipFile,
  entries: readonly Entry[],
): Promise<void> {
  const paths = new Set(
    entries.map((entry) => normalizeArchivePath(entry.fileName)),
  );

  if (!paths.has("database.db") || !paths.has("toc.json")) {
    throw new Error("Unsupported legacy sdpub archive.");
  }
  if (paths.has("manifest.json")) {
    const manifestEntry = entries.find(
      (entry) => normalizeArchivePath(entry.fileName) === "manifest.json",
    );

    if (manifestEntry === undefined) {
      throw new Error("Unsupported legacy sdpub archive.");
    }

    assertSupportedManifest(await readArchiveEntryText(zipFile, manifestEntry));
  }
}

function assertSupportedManifest(content: string): void {
  try {
    const parsed = JSON.parse(content) as { readonly formatVersion?: unknown };

    if (parsed.formatVersion === LEGACY_FORMAT_VERSION) {
      return;
    }
  } catch {
    throw new Error("Unsupported legacy sdpub archive.");
  }

  throw new Error("Unsupported legacy sdpub archive.");
}

async function migrateKnowledgeEdgesInDatabase(
  databasePath: string,
): Promise<void> {
  const database = await Database.open(databasePath);

  try {
    await migrateKnowledgeEdges(database);
  } finally {
    await database.close();
  }
}

async function migrateKnowledgeEdges(database: Database): Promise<void> {
  const tables = await listTableNames(database);

  if (tables.has("reading_edges")) {
    return;
  }
  if (!tables.has("knowledge_edges")) {
    return;
  }

  await database.run(`
    ALTER TABLE knowledge_edges
    RENAME TO reading_edges
  `);
}

interface LegacyFragmentFile {
  readonly sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
  readonly summary: string;
}

interface LegacyFragmentRecord {
  readonly content: LegacyFragmentFile;
  readonly fragmentId: number;
  readonly path: string;
  readonly signature: string;
}

interface SentenceIndexRemap {
  get(fragmentId: number, sentenceIndex: number): number | undefined;
  readonly serialId: number;
}

async function migrateLegacyTextStorage(workspacePath: string): Promise<void> {
  const sourceSerials = await listLegacySourceSerials(workspacePath);
  const remaps = new Map<number, SentenceIndexRemap>();

  for (const serialId of sourceSerials) {
    const fragments = await readLegacySourceFragments(workspacePath, serialId);
    const plan = createDuplicateHalfCanonicalizationPlan(fragments);
    const canonicalFragments = plan?.canonicalFragments ?? fragments;
    const fragmentIdMap = plan?.fragmentIdMap ?? new Map<number, number>();
    const canonicalById = new Map(
      canonicalFragments.map((fragment) => [fragment.fragmentId, fragment]),
    );
    const sentenceMap = new Map<string, number>();
    const textParts: string[] = [];
    let globalSentenceIndex = 0;

    for (const fragment of canonicalFragments) {
      for (
        let localSentenceIndex = 0;
        localSentenceIndex < fragment.content.sentences.length;
        localSentenceIndex += 1
      ) {
        const sentence = fragment.content.sentences[localSentenceIndex];

        if (sentence === undefined) {
          continue;
        }

        sentenceMap.set(
          `${fragment.fragmentId}:${localSentenceIndex}`,
          globalSentenceIndex,
        );
        textParts.push(sentence.text);
        globalSentenceIndex += 1;
      }
    }

    for (const [oldFragmentId, canonicalFragmentId] of fragmentIdMap) {
      const canonicalFragment = canonicalById.get(canonicalFragmentId);

      if (canonicalFragment === undefined) {
        continue;
      }

      for (
        let localSentenceIndex = 0;
        localSentenceIndex < canonicalFragment.content.sentences.length;
        localSentenceIndex += 1
      ) {
        const mapped = sentenceMap.get(
          `${canonicalFragmentId}:${localSentenceIndex}`,
        );

        if (mapped !== undefined) {
          sentenceMap.set(`${oldFragmentId}:${localSentenceIndex}`, mapped);
        }
      }
    }

    remaps.set(serialId, {
      get: (fragmentId, sentenceIndex) =>
        sentenceMap.get(`${fragmentId}:${sentenceIndex}`),
      serialId,
    });

    const database = await Database.open(join(workspacePath, "database.db"));

    try {
      await writeLegacySourceTextStream(database, workspacePath, {
        fragments: canonicalFragments,
        serialId,
        text: textParts.join(""),
      });
    } finally {
      await database.close();
    }
  }

  await migrateLegacySentenceReferences(workspacePath, remaps);
  await migrateLegacySummariesToTextStreams(workspacePath);
  await rm(join(workspacePath, "fragments"), { force: true, recursive: true });
  await rm(join(workspacePath, "summaries"), { force: true, recursive: true });
}

async function migrateLegacySentenceReferences(
  workspacePath: string,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const database = await Database.open(join(workspacePath, "database.db"));

  try {
    const tableNames = await listTableNames(database);

    await database.transaction(async () => {
      if (tableNames.has("chunks")) {
        await migrateLegacyChunks(database, remaps);
      }
      if (tableNames.has("chunk_sentences")) {
        await migrateLegacyChunkSentences(database, remaps);
      }
      if (tableNames.has("mentions")) {
        await migrateLegacyMentions(database, remaps);
      }
      if (tableNames.has("mention_link_evidence_sentences")) {
        await migrateLegacyMentionLinkEvidenceSentences(database, remaps);
      }
      if (tableNames.has("fragment_groups")) {
        await migrateLegacyFragmentGroups(database, remaps);
      }
    });
  } finally {
    await database.close();
  }
}

async function writeLegacySourceTextStream(
  database: Database,
  workspacePath: string,
  input: {
    readonly fragments: readonly LegacyFragmentRecord[];
    readonly serialId: number;
    readonly text: string;
  },
): Promise<void> {
  await database.run(`
    CREATE TABLE IF NOT EXISTS text_sentence_records (
      id INTEGER PRIMARY KEY,
      kind INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      words_count INTEGER NOT NULL DEFAULT 0,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      byte_length INTEGER NOT NULL DEFAULT 0,
      UNIQUE(kind, chapter_id, sentence_index)
    )
  `);
  await mkdir(join(workspacePath, "texts", "source"), { recursive: true });
  await writeFile(
    join(workspacePath, "texts", "source", `${input.serialId}.txt`),
    input.text,
    "utf8",
  );
  await database.run(
    `
      DELETE FROM text_sentence_records
      WHERE kind = 1 AND chapter_id = ?
    `,
    [input.serialId],
  );

  let byteOffset = 0;
  let sentenceIndex = 0;

  for (const fragment of input.fragments) {
    for (const sentence of fragment.content.sentences) {
      const byteLength = Buffer.byteLength(sentence.text, "utf8");

      await database.run(
        `
          INSERT OR REPLACE INTO text_sentence_records (
            kind,
            chapter_id,
            sentence_index,
            words_count,
            byte_offset,
            byte_length
          )
          VALUES (1, ?, ?, ?, ?, ?)
        `,
        [
          input.serialId,
          sentenceIndex,
          sentence.wordsCount,
          byteOffset,
          byteLength,
        ],
      );

      byteOffset += byteLength;
      sentenceIndex += 1;
    }
  }
}

async function migrateLegacyChunks(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT *
      FROM chunks
      ORDER BY id
    `,
    undefined,
    (row) => row,
  );

  await database.run("ALTER TABLE chunks RENAME TO legacy_chunks");
  await database.run(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      generation INTEGER NOT NULL,
      serial_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      retention TEXT,
      importance TEXT,
      wordsCount INTEGER NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0.0
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);
    const sentenceIndex = remapSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
      Number(row.sentence_index),
    );

    await database.run(
      `
        INSERT INTO chunks (
          id, generation, serial_id, sentence_index, label, content,
          retention, importance, wordsCount, weight
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.id ?? null,
        row.generation ?? 0,
        serialId,
        sentenceIndex,
        row.label ?? "",
        row.content ?? "",
        row.retention ?? null,
        row.importance ?? null,
        row.wordsCount ?? 0,
        row.weight ?? 0,
      ],
    );
  }

  await database.run("DROP TABLE legacy_chunks");
}

async function migrateLegacyChunkSentences(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT chunk_id, serial_id, fragment_id, sentence_index
      FROM chunk_sentences
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE chunk_sentences");
  await database.run(`
    CREATE TABLE chunk_sentences (
      chunk_id INTEGER NOT NULL,
      serial_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id),
      PRIMARY KEY (chunk_id, serial_id, sentence_index)
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);

    await database.run(
      `
        INSERT OR IGNORE INTO chunk_sentences (
          chunk_id, serial_id, sentence_index
        )
        VALUES (?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.chunk_id),
        serialId,
        remapSentenceIndex(
          remaps,
          serialId,
          Number(row.fragment_id),
          Number(row.sentence_index),
        ),
      ],
    );
  }
}

async function migrateLegacyMentions(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT *
      FROM mentions
      ORDER BY id
    `,
    undefined,
    (row) => row,
  );

  await database.run("ALTER TABLE mentions RENAME TO legacy_mentions");
  await database.run(`
    CREATE TABLE mentions (
      id TEXT PRIMARY KEY,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER,
      range_start INTEGER NOT NULL,
      range_end INTEGER NOT NULL,
      surface TEXT NOT NULL,
      qid TEXT NOT NULL,
      confidence REAL,
      note TEXT,
      FOREIGN KEY (chapter_id) REFERENCES serials(id)
    )
  `);

  for (const row of rows) {
    const chapterId = Number(row.chapter_id);
    const sentenceIndex =
      row.sentence_index === null || row.sentence_index === undefined
        ? null
        : remapSentenceIndex(
            remaps,
            chapterId,
            Number(row.fragment_id),
            Number(row.sentence_index),
          );

    await database.run(
      `
        INSERT OR REPLACE INTO mentions (
          id, chapter_id, sentence_index, range_start, range_end, surface,
          qid, confidence, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.id),
        chapterId,
        sentenceIndex,
        row.range_start ?? 0,
        row.range_end ?? 0,
        row.surface ?? "",
        row.qid ?? "",
        row.confidence ?? null,
        row.note ?? null,
      ],
    );
  }

  await database.run("DROP TABLE legacy_mentions");
}

async function migrateLegacyMentionLinkEvidenceSentences(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT link_id, chapter_id, fragment_id, sentence_index
      FROM mention_link_evidence_sentences
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE mention_link_evidence_sentences");
  await database.run(`
    CREATE TABLE mention_link_evidence_sentences (
      link_id TEXT NOT NULL,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      FOREIGN KEY (link_id) REFERENCES mention_links(id),
      PRIMARY KEY (link_id, chapter_id, sentence_index)
    )
  `);

  for (const row of rows) {
    const chapterId = Number(row.chapter_id);

    await database.run(
      `
        INSERT OR IGNORE INTO mention_link_evidence_sentences (
          link_id, chapter_id, sentence_index
        )
        VALUES (?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.link_id),
        chapterId,
        remapSentenceIndex(
          remaps,
          chapterId,
          Number(row.fragment_id),
          Number(row.sentence_index),
        ),
      ],
    );
  }
}

async function migrateLegacyFragmentGroups(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT serial_id, group_id, fragment_id
      FROM fragment_groups
      ORDER BY serial_id, group_id, fragment_id
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE fragment_groups");
  await database.run(`
    CREATE TABLE sentence_groups (
      serial_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      start_sentence_index INTEGER NOT NULL,
      end_sentence_index INTEGER NOT NULL,
      PRIMARY KEY (serial_id, group_id, start_sentence_index, end_sentence_index)
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);
    const startSentenceIndex = remapSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
      0,
    );
    const endSentenceIndex = findFragmentEndSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
    );

    await database.run(
      `
        INSERT OR IGNORE INTO sentence_groups (
          serial_id, group_id, start_sentence_index, end_sentence_index
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        serialId,
        getRequiredSqlBindValue(row.group_id),
        startSentenceIndex,
        endSentenceIndex,
      ],
    );
  }
}

function remapSentenceIndex(
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
  serialId: number,
  fragmentId: number,
  sentenceIndex: number,
): number {
  const remap = remaps.get(serialId);
  const mapped = remap?.get(fragmentId, sentenceIndex);

  if (mapped === undefined) {
    throw new Error(
      `Cannot remap legacy sentence ${serialId}:${fragmentId}:${sentenceIndex}.`,
    );
  }

  return mapped;
}

function findFragmentEndSentenceIndex(
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
  serialId: number,
  fragmentId: number,
): number {
  let sentenceIndex = 0;
  let last: number | undefined;

  while (true) {
    const mapped = remaps.get(serialId)?.get(fragmentId, sentenceIndex);

    if (mapped === undefined) {
      break;
    }

    last = mapped;
    sentenceIndex += 1;
  }

  return last ?? remapSentenceIndex(remaps, serialId, fragmentId, 0);
}

async function migrateLegacySummariesToTextStreams(
  workspacePath: string,
): Promise<void> {
  const summaries = await listLegacySummaries(workspacePath);
  const document = await DirectoryDocument.open(workspacePath);

  try {
    for (const summary of summaries) {
      await document.writeSummary(summary.serialId, summary.text);
    }
  } finally {
    await document.release();
  }
}

async function listLegacySourceSerials(
  workspacePath: string,
): Promise<readonly number[]> {
  const fragmentsDirectory = join(workspacePath, "fragments");

  try {
    const entries = await readdir(fragmentsDirectory, { withFileTypes: true });
    const serialIds: number[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const match = /^serial-(\d+)$/u.exec(entry.name);

      if (match !== null) {
        serialIds.push(Number(match[1]));
      }
    }

    return serialIds.sort((left, right) => left - right);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readLegacySourceFragments(
  workspacePath: string,
  serialId: number,
): Promise<readonly LegacyFragmentRecord[]> {
  const serialDirectory = join(
    workspacePath,
    "fragments",
    `serial-${serialId}`,
  );
  const entries = await readdir(serialDirectory, { withFileTypes: true });
  const records: LegacyFragmentRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = /^fragment_(\d+)\.json$/u.exec(entry.name);

    if (match === null) {
      continue;
    }

    const path = join(serialDirectory, entry.name);
    const content = parseLegacyFragmentFile(await readFile(path, "utf8"));

    records.push({
      content,
      fragmentId: Number(match[1]),
      path,
      signature: createLegacyFragmentSignature(content),
    });
  }

  return records.sort((left, right) => left.fragmentId - right.fragmentId);
}

function parseLegacyFragmentFile(content: string): LegacyFragmentFile {
  const parsed = JSON.parse(content) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }

  const rawFragment = parsed as Record<string, unknown>;

  if (!Array.isArray(rawFragment.sentences)) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }

  const sentences = rawFragment.sentences.map((sentence) => {
    if (
      typeof sentence !== "object" ||
      sentence === null ||
      !("text" in sentence) ||
      typeof (sentence as Record<string, unknown>).text !== "string"
    ) {
      throw new TypeError("Legacy fragment sentence must contain text.");
    }

    const rawSentence = sentence as Record<string, unknown>;
    const text = rawSentence.text as string;
    const rawWordsCount = rawSentence.wordsCount;
    const wordsCount =
      typeof rawWordsCount === "number" ? rawWordsCount : countWords(text);

    return {
      text,
      wordsCount,
    };
  });
  const summary =
    typeof rawFragment.summary === "string" ? rawFragment.summary : "";

  return { sentences, summary };
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function createLegacyFragmentSignature(fragment: LegacyFragmentFile): string {
  return JSON.stringify(fragment.sentences.map((sentence) => sentence.text));
}

function createDuplicateHalfCanonicalizationPlan(
  fragments: readonly LegacyFragmentRecord[],
):
  | {
      readonly canonicalFragments: readonly LegacyFragmentRecord[];
      readonly fragmentIdMap: ReadonlyMap<number, number>;
    }
  | undefined {
  if (fragments.length < 2 || fragments.length % 2 !== 0) {
    return undefined;
  }

  const halfLength = fragments.length / 2;
  const leftHalf = fragments.slice(0, halfLength);
  const rightHalf = fragments.slice(halfLength);

  for (let index = 0; index < halfLength; index += 1) {
    if (leftHalf[index]?.signature !== rightHalf[index]?.signature) {
      return undefined;
    }
  }

  const preferRightHalf = rightHalf.some(
    (fragment) => fragment.content.summary.trim() !== "",
  );
  const sourceFragments = preferRightHalf ? rightHalf : leftHalf;
  const fragmentIdMap = new Map<number, number>();
  const canonicalFragments = sourceFragments.map((fragment, index) => {
    const leftFragment = leftHalf[index];
    const rightFragment = rightHalf[index];

    if (leftFragment !== undefined) {
      fragmentIdMap.set(leftFragment.fragmentId, index);
    }
    if (rightFragment !== undefined) {
      fragmentIdMap.set(rightFragment.fragmentId, index);
    }

    return {
      ...fragment,
      fragmentId: index,
    };
  });

  return { canonicalFragments, fragmentIdMap };
}

function getRequiredSqlBindValue(
  value: SqlBindValue | undefined,
): SqlBindValue {
  if (value === undefined) {
    throw new TypeError("Expected a SQLite bind value.");
  }

  return value;
}

async function listLegacySummaries(
  workspacePath: string,
): Promise<Array<{ readonly serialId: number; readonly text: string }>> {
  const summaryDirectory = join(workspacePath, "summaries");

  try {
    const entries = await readdir(summaryDirectory, { withFileTypes: true });
    const summaries: Array<{ serialId: number; text: string }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const match = /^serial-(\d+)\.txt$/u.exec(entry.name);

      if (match === null) {
        continue;
      }

      summaries.push({
        serialId: Number(match[1]),
        text: await readFile(join(summaryDirectory, entry.name), "utf8"),
      });
    }

    return summaries.sort((left, right) => left.serialId - right.serialId);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function listTableNames(
  database: Database,
): Promise<ReadonlySet<string>> {
  const names = await database.queryAll(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `,
    undefined,
    (row) => String(row.name),
  );

  return new Set(names);
}

async function indexArchiveEntries(
  zipFile: YauzlZipFile,
): Promise<readonly Entry[]> {
  return await new Promise((resolve, reject) => {
    const entries: Entry[] = [];

    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }

      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      resolve(entries);
    });
    zipFile.once("error", (error: Error) => {
      reject(error);
    });

    zipFile.readEntry();
  });
}

function isLegacySdpubPath(archivePath: string): boolean {
  return LEGACY_SDPUB_PATTERNS.some((pattern) => pattern.test(archivePath));
}

function assertWithinDirectory(
  rootDirectoryPath: string,
  targetPath: string,
  archivePath: string,
): void {
  const resolvedRootDirectoryPath = resolve(rootDirectoryPath);
  const rootPrefix = resolvedRootDirectoryPath.endsWith(sep)
    ? resolvedRootDirectoryPath
    : `${resolvedRootDirectoryPath}${sep}`;

  if (
    targetPath === resolvedRootDirectoryPath ||
    targetPath.startsWith(rootPrefix)
  ) {
    return;
  }

  throw new Error(`Invalid archive entry path: ${archivePath}`);
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  const withoutLeadingSlash = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  return posix
    .normalize(withoutLeadingSlash)
    .replace(/^(\.\/)+/u, "")
    .replace(/^\/+/u, "");
}

async function openArchive(path: string): Promise<YauzlZipFile> {
  return await new Promise((resolveOpen, rejectOpen) => {
    openZip(path, { autoClose: false, lazyEntries: true }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) {
        rejectOpen(error ?? new Error(`Cannot open archive: ${path}`));
        return;
      }

      resolveOpen(zipFile);
    });
  });
}

async function openArchiveEntryStream(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<NodeJS.ReadableStream> {
  return await new Promise((resolveStream, rejectStream) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        rejectStream(
          error ?? new Error(`Cannot open archive entry: ${entry.fileName}`),
        );
        return;
      }

      resolveStream(stream);
    });
  });
}

async function readArchiveEntryText(
  zipFile: YauzlZipFile,
  entry: Entry,
): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = await openArchiveEntryStream(zipFile, entry);

  await new Promise<void>((resolveRead, rejectRead) => {
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.once("end", resolveRead);
    stream.once("error", rejectRead);
  });

  return Buffer.concat(chunks).toString("utf8");
}
