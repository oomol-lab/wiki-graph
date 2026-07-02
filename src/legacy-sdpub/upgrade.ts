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
import { initializeDocumentSchema, SCHEMA_SQL } from "../document/schema.js";
import { writeWikgArchive } from "../facade/archive.js";
import { rebuildArchiveSearchIndex } from "../facade/archive-view.js";
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
    await migrateDatabase(join(workspacePath, "database.db"));
    await canonicalizeLegacySourceFragments(workspacePath);
    await migrateSummaries(workspacePath);
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

async function migrateDatabase(databasePath: string): Promise<void> {
  const legacyDatabase = await Database.open(databasePath);

  try {
    await migrateKnowledgeEdges(legacyDatabase);
  } finally {
    await legacyDatabase.close();
  }

  const database = await Database.open(databasePath, SCHEMA_SQL);

  try {
    await initializeDocumentSchema(database);
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

async function canonicalizeLegacySourceFragments(
  workspacePath: string,
): Promise<void> {
  const serials = await listLegacySourceSerials(workspacePath);

  if (serials.length === 0) {
    return;
  }

  const database = await Database.open(join(workspacePath, "database.db"));

  try {
    const tableNames = await listTableNames(database);

    for (const serialId of serials) {
      const fragments = await readLegacySourceFragments(
        workspacePath,
        serialId,
      );
      const plan = createDuplicateHalfCanonicalizationPlan(fragments);

      if (plan === undefined) {
        continue;
      }

      await rewriteLegacySourceFragments(fragments, plan.canonicalFragments);
      await remapLegacySourceReferences(
        database,
        tableNames,
        serialId,
        plan.fragmentIdMap,
      );
    }
  } finally {
    await database.close();
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

async function rewriteLegacySourceFragments(
  existingFragments: readonly LegacyFragmentRecord[],
  canonicalFragments: readonly LegacyFragmentRecord[],
): Promise<void> {
  for (const fragment of existingFragments) {
    await rm(fragment.path, { force: true });
  }

  for (const fragment of canonicalFragments) {
    await writeFile(
      fragment.path.replace(
        /fragment_\d+\.json$/u,
        `fragment_${fragment.fragmentId}.json`,
      ),
      JSON.stringify(
        {
          sentences: fragment.content.sentences,
          summary: fragment.content.summary,
        },
        undefined,
        2,
      ),
      "utf8",
    );
  }
}

async function remapLegacySourceReferences(
  database: Database,
  tableNames: ReadonlySet<string>,
  serialId: number,
  fragmentIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  await database.transaction(async () => {
    if (tableNames.has("chunks")) {
      await remapSimpleFragmentColumn(database, {
        idColumn: "id",
        serialColumn: "serial_id",
        serialId,
        table: "chunks",
        fragmentIdMap,
      });
    }
    if (tableNames.has("mentions")) {
      await remapSimpleFragmentColumn(database, {
        idColumn: "id",
        serialColumn: "chapter_id",
        serialId,
        table: "mentions",
        fragmentIdMap,
      });
    }
    if (tableNames.has("chunk_sentences")) {
      await remapChunkSentences(database, serialId, fragmentIdMap);
    }
    if (tableNames.has("fragment_groups")) {
      await remapFragmentGroups(database, serialId, fragmentIdMap);
    }
    if (tableNames.has("mention_link_evidence_sentences")) {
      await remapMentionLinkEvidenceSentences(
        database,
        serialId,
        fragmentIdMap,
      );
    }
  });
}

async function remapSimpleFragmentColumn(
  database: Database,
  input: {
    readonly fragmentIdMap: ReadonlyMap<number, number>;
    readonly idColumn: string;
    readonly serialColumn: string;
    readonly serialId: number;
    readonly table: string;
  },
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT ${input.idColumn} AS id, fragment_id
      FROM ${input.table}
      WHERE ${input.serialColumn} = ?
    `,
    [input.serialId],
    (row) => ({
      fragmentId: Number(row.fragment_id),
      id: getRequiredSqlBindValue(row.id),
    }),
  );

  for (const row of rows) {
    const fragmentId = input.fragmentIdMap.get(row.fragmentId);

    if (fragmentId === undefined || fragmentId === row.fragmentId) {
      continue;
    }

    await database.run(
      `
        UPDATE ${input.table}
        SET fragment_id = ?
        WHERE ${input.idColumn} = ?
      `,
      [fragmentId, row.id],
    );
  }
}

function getRequiredSqlBindValue(
  value: SqlBindValue | undefined,
): SqlBindValue {
  if (value === undefined) {
    throw new TypeError("Expected a SQLite bind value.");
  }

  return value;
}

async function remapChunkSentences(
  database: Database,
  serialId: number,
  fragmentIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT chunk_id, serial_id, fragment_id, sentence_index
      FROM chunk_sentences
      WHERE serial_id = ?
    `,
    [serialId],
    (row) => ({
      chunkId: Number(row.chunk_id),
      fragmentId: Number(row.fragment_id),
      sentenceIndex: Number(row.sentence_index),
      serialId: Number(row.serial_id),
    }),
  );

  await database.run("DELETE FROM chunk_sentences WHERE serial_id = ?", [
    serialId,
  ]);

  for (const row of rows) {
    await database.run(
      `
        INSERT OR IGNORE INTO chunk_sentences (
          chunk_id,
          serial_id,
          fragment_id,
          sentence_index
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        row.chunkId,
        row.serialId,
        fragmentIdMap.get(row.fragmentId) ?? row.fragmentId,
        row.sentenceIndex,
      ],
    );
  }
}

async function remapFragmentGroups(
  database: Database,
  serialId: number,
  fragmentIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT serial_id, group_id, fragment_id
      FROM fragment_groups
      WHERE serial_id = ?
    `,
    [serialId],
    (row) => ({
      fragmentId: Number(row.fragment_id),
      groupId: Number(row.group_id),
      serialId: Number(row.serial_id),
    }),
  );

  await database.run("DELETE FROM fragment_groups WHERE serial_id = ?", [
    serialId,
  ]);

  for (const row of rows) {
    await database.run(
      `
        INSERT OR IGNORE INTO fragment_groups (
          serial_id,
          group_id,
          fragment_id
        )
        VALUES (?, ?, ?)
      `,
      [
        row.serialId,
        row.groupId,
        fragmentIdMap.get(row.fragmentId) ?? row.fragmentId,
      ],
    );
  }
}

async function remapMentionLinkEvidenceSentences(
  database: Database,
  serialId: number,
  fragmentIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT link_id, chapter_id, fragment_id, sentence_index
      FROM mention_link_evidence_sentences
      WHERE chapter_id = ?
    `,
    [serialId],
    (row) => ({
      chapterId: Number(row.chapter_id),
      fragmentId: Number(row.fragment_id),
      linkId: String(row.link_id),
      sentenceIndex: Number(row.sentence_index),
    }),
  );

  await database.run(
    "DELETE FROM mention_link_evidence_sentences WHERE chapter_id = ?",
    [serialId],
  );

  for (const row of rows) {
    await database.run(
      `
        INSERT OR IGNORE INTO mention_link_evidence_sentences (
          link_id,
          chapter_id,
          fragment_id,
          sentence_index
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        row.linkId,
        row.chapterId,
        fragmentIdMap.get(row.fragmentId) ?? row.fragmentId,
        row.sentenceIndex,
      ],
    );
  }
}

async function migrateSummaries(workspacePath: string): Promise<void> {
  const summaries = await listLegacySummaries(workspacePath);

  if (summaries.length === 0) {
    return;
  }

  const document = await DirectoryDocument.open(workspacePath);

  try {
    for (const summary of summaries) {
      await document.writeSummary(summary.serialId, summary.text);
      await rm(
        join(workspacePath, "summaries", `serial-${summary.serialId}.txt`),
        {
          force: true,
        },
      );
    }
  } finally {
    await document.release();
  }
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
