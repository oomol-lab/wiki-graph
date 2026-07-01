import { createWriteStream } from "fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "fs/promises";
import { dirname, join, posix, resolve, sep } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "yauzl";

import { Database } from "../document/database.js";
import { DirectoryDocument } from "../document/document.js";
import { initializeDocumentSchema, SCHEMA_SQL } from "../document/schema.js";
import { writeWikgArchive } from "../facade/archive.js";
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
    await migrateSummaries(workspacePath);
    await writeWikgArchive(workspacePath, outputPath);

    return { inputPath, outputPath };
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
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
