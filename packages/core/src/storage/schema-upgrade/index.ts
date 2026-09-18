import { DirectoryDocument } from "../../document/index.js";
import { ensureChapterKeys } from "../../document/chapter/toc.js";
import type { MutableTocFile } from "../../document/chapter/tree.js";
import { TEXT_STREAM_KIND } from "../../document/text-streams/types.js";
import { ensureWikiGraphHomeSchemaCurrent } from "../../document/home-schema-upgrade.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import {
  ensureRelativeDirectory,
  getWikiGraphPlatform,
  getWikiGraphStorage,
  readHostZipEntries,
  resolveHostFile,
  type Directory,
  type File,
} from "../../runtime/platform/index.js";
import { countTextWords } from "../../utils/text-word-count.js";
import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
} from "../wikg/archive/constants.js";
import {
  createWikgMutationTokenBytes,
  parseWikgManifest,
  WIKG_MANIFEST_CONTENT,
} from "../wikg/archive/manifest.js";
import {
  isWikgArchivePath,
  normalizeArchivePath,
  sortArchiveEntryPathsForWrite,
} from "../wikg/archive/paths.js";
import {
  assertArchiveUpgradeCoordinatorSafe,
  clearArchiveUpgradeDerivedOverlays,
} from "../wikg/wikg-coordinator/index.js";

export {
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphHomeSchemaVersion,
} from "../../document/home-schema-upgrade.js";

export const CURRENT_ARCHIVE_SCHEMA_VERSION = 5;

export interface WikiGraphArchiveSchemaUpgradeResult {
  readonly changed: boolean;
  readonly repairedToc: boolean;
  readonly repairedTextWords: boolean;
  readonly schemaChanged: boolean;
}

const archiveUpgradeQueues = new Map<string, Promise<void>>();
let workspaceSequence = 0;

export async function ensureWikiGraphArchiveSchemaCurrent(
  archiveRef: File | string,
): Promise<void> {
  const archive = await resolveHostFile(archiveRef);
  const schemaVersion = await readWikiGraphArchiveSchemaVersion(archive);
  if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
    );
  }
  if (schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `This Wiki Graph archive uses schema v${schemaVersion} and must be upgraded before use.`,
    );
  }
}

export async function readWikiGraphArchiveSchemaVersion(
  archiveRef: File | string,
): Promise<number> {
  const archive = await resolveHostFile(archiveRef);
  const entries = await readArchiveEntries(archive);
  const manifest = entries.get(WIKG_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  return parseWikgManifest(new TextDecoder().decode(manifest)).schemaVersion;
}

export async function upgradeWikiGraphArchiveSchema(
  archiveRef: File | string,
): Promise<WikiGraphArchiveSchemaUpgradeResult> {
  const archive = await resolveHostFile(archiveRef);
  return await serializeArchiveUpgrade(archive, async () => {
    const entries = await readArchiveEntries(archive);
    const manifest = entries.get(WIKG_MANIFEST_PATH);
    if (manifest === undefined) {
      throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
    }
    const schemaVersion = parseWikgManifest(
      new TextDecoder().decode(manifest),
    ).schemaVersion;
    if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
      );
    }

    await ensureWikiGraphHomeSchemaCurrent();
    await assertArchiveUpgradeCoordinatorSafe(archive);

    const root = getWikiGraphStorage().documentStore;
    const workspaceName = await createWorkspaceName(root);
    const workspace = await root.createDirectory(workspaceName);
    try {
      await materializeArchiveEntries(workspace, entries);
      const repairedToc = await repairChapterToc(workspace);
      const schemaChanged = schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION;
      const databaseResult = await upgradeArchiveDatabase(workspace, {
        addCharacterOffsets: schemaVersion < 5,
        refreshArtifacts: schemaVersion < 3,
      });

      if (!schemaChanged && !repairedToc && !databaseResult.repairedTextWords) {
        return {
          changed: false,
          repairedToc: false,
          repairedTextWords: false,
          schemaChanged: false,
        };
      }

      if (schemaChanged) {
        entries.delete(SEARCH_INDEX_DATABASE_PATH);
        entries.delete(LEGACY_SEARCH_INDEX_DATABASE_PATH);
      }
      await mergeWorkspaceEntries(entries, workspace);
      entries.set(
        WIKG_MANIFEST_PATH,
        new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
      );
      entries.set(
        WIKG_MUTATION_TOKEN_PATH,
        entries.get(WIKG_MUTATION_TOKEN_PATH) ?? createWikgMutationTokenBytes(),
      );
      await getWikiGraphPlatform().zip.write(
        archive,
        sortArchiveEntryPathsForWrite(entries.keys()).map((name) => ({
          data: entries.get(name) as Uint8Array,
          name,
        })),
      );
      await clearArchiveUpgradeDerivedOverlays(archive);
      await cleanupArchiveDerivedData();

      return {
        changed: true,
        repairedToc,
        repairedTextWords: databaseResult.repairedTextWords,
        schemaChanged,
      };
    } finally {
      await root
        .remove(workspaceName, { recursive: true })
        .catch(() => undefined);
    }
  });
}

async function readArchiveEntries(
  archive: File,
): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  for (const entry of await readHostZipEntries(archive)) {
    const name = normalizeArchivePath(entry.name);
    if (name !== "" && isWikgArchivePath(name)) entries.set(name, entry.data);
  }
  return entries;
}

async function materializeArchiveEntries(
  root: Directory,
  entries: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const [name, data] of entries) {
    if (name === WIKG_MANIFEST_PATH || name === WIKG_MUTATION_TOKEN_PATH) {
      continue;
    }
    await replaceFile(await getOrCreateRelativeFile(root, name), data);
  }
}

async function mergeWorkspaceEntries(
  entries: Map<string, Uint8Array>,
  root: Directory,
  prefix = "",
): Promise<void> {
  for (const child of await root.list()) {
    const name = prefix === "" ? child.name : `${prefix}/${child.name}`;
    if ("read" in child) {
      const content = await child.read();
      entries.set(
        name,
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      );
    } else {
      await mergeWorkspaceEntries(entries, child, name);
    }
  }
}

async function repairChapterToc(workspace: Directory): Promise<boolean> {
  const tocFile = await workspace.getFile("toc.json");
  if (tocFile === undefined) return false;
  const content = await tocFile.read({ encoding: "utf8" });
  try {
    const raw = JSON.parse(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    ) as unknown;
    if (!isMutableTocFile(raw)) return false;
    const mutable = normalizeLegacyToc(raw);
    if (!ensureChapterKeys(mutable.items)) return false;
    await replaceFile(tocFile, `${JSON.stringify(mutable, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function isMutableTocFile(value: unknown): value is MutableTocFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

function normalizeLegacyToc(value: MutableTocFile): MutableTocFile {
  return {
    items: value.items.map(normalizeLegacyTocItem),
    version: value.version,
  };
}

function normalizeLegacyTocItem(
  value: MutableTocFile["items"][number],
): MutableTocFile["items"][number] {
  return {
    ...value,
    children: Array.isArray(value.children)
      ? value.children.map(normalizeLegacyTocItem)
      : [],
  };
}

async function upgradeArchiveDatabase(
  workspace: Directory,
  options: {
    readonly addCharacterOffsets: boolean;
    readonly refreshArtifacts: boolean;
  },
): Promise<{ readonly repairedTextWords: boolean }> {
  if ((await workspace.getFile("database.db")) === undefined) {
    return { repairedTextWords: false };
  }
  const document = await DirectoryDocument.open(workspace);
  try {
    if (options.addCharacterOffsets) {
      await addTextSentenceCharacterColumns(document);
    }
    const repairedTextWords = await repairTextSentenceWordCounts(document);
    if (options.refreshArtifacts) await refreshChapterArtifacts(document);
    return { repairedTextWords };
  } finally {
    await document.release();
  }
}

async function addTextSentenceCharacterColumns(
  document: DirectoryDocument,
): Promise<void> {
  await document.readDatabase(async (database) => {
    const columns = new Set(
      await database.queryAll(
        "PRAGMA table_info(text_sentence_records)",
        undefined,
        (row) => String(row.name),
      ),
    );
    if (!columns.has("character_offset")) {
      await database.run(
        "ALTER TABLE text_sentence_records ADD COLUMN character_offset INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!columns.has("character_length")) {
      await database.run(
        "ALTER TABLE text_sentence_records ADD COLUMN character_length INTEGER NOT NULL DEFAULT 0",
      );
    }
  });
}

async function refreshChapterArtifacts(
  document: DirectoryDocument,
): Promise<void> {
  const serialIds = await document.readDatabase(async (database) =>
    database.queryAll(
      "SELECT id FROM serials ORDER BY document_order, id",
      undefined,
      (row) => Number(row.id),
    ),
  );
  for (const serialId of serialIds) {
    await replaceChapterFtsIndexArtifact(document, serialId);
  }
  await document.readDatabase(async (database) => {
    await database.run("DROP TABLE IF EXISTS archive_index_settings");
  });
}

async function repairTextSentenceWordCounts(
  document: DirectoryDocument,
): Promise<boolean> {
  const rows = await document.readDatabase(async (database) =>
    database.queryAll(
      `SELECT kind, chapter_id, sentence_index, words_count, byte_offset, byte_length,
              character_offset, character_length
       FROM text_sentence_records ORDER BY kind, chapter_id, sentence_index`,
      undefined,
      (row) => ({
        byteLength: Number(row.byte_length),
        byteOffset: Number(row.byte_offset),
        chapterId: Number(row.chapter_id),
        characterLength: Number(row.character_length),
        characterOffset: Number(row.character_offset),
        kind: Number(row.kind),
        sentenceIndex: Number(row.sentence_index),
        wordsCount: Number(row.words_count),
      }),
    ),
  );
  let cachedTextKey: string | undefined;
  let cachedText: Uint8Array | undefined;
  let cachedByteEnd = 0;
  let cachedCharacterEnd = 0;
  let repairedTextWords = false;
  const updates: Array<{
    readonly chapterId: number;
    readonly kind: number;
    readonly sentenceIndex: number;
    readonly characterLength: number;
    readonly characterOffset: number;
    readonly wordsCount: number;
  }> = [];

  for (const row of rows) {
    const streamName = getTextStreamName(row.kind);
    if (streamName === undefined) continue;
    const key = `${streamName}:${row.chapterId}`;
    if (key !== cachedTextKey) {
      cachedTextKey = key;
      const text =
        streamName === "source"
          ? await document.getSerialFragments(row.chapterId).readText()
          : await document.getSummaryFragments(row.chapterId).readText();
      cachedText =
        text === undefined ? undefined : new TextEncoder().encode(text);
      cachedByteEnd = 0;
      cachedCharacterEnd = 0;
    }
    if (cachedText === undefined) continue;
    const characterOffset =
      cachedCharacterEnd +
      Array.from(
        new TextDecoder().decode(
          cachedText.subarray(cachedByteEnd, row.byteOffset),
        ),
      ).length;
    const sentence = new TextDecoder().decode(
      cachedText.subarray(row.byteOffset, row.byteOffset + row.byteLength),
    );
    const characterLength = Array.from(sentence).length;
    const wordsCount = countTextWords(sentence);
    cachedByteEnd = row.byteOffset + row.byteLength;
    cachedCharacterEnd = characterOffset + characterLength;
    if (wordsCount !== row.wordsCount) repairedTextWords = true;
    if (
      wordsCount !== row.wordsCount ||
      characterOffset !== row.characterOffset ||
      characterLength !== row.characterLength
    ) {
      updates.push({
        ...row,
        characterLength,
        characterOffset,
        wordsCount,
      });
    }
  }

  if (updates.length === 0) return false;
  await document.readDatabase(async (database) => {
    await database.transaction(async () => {
      for (const update of updates) {
        await database.run(
          `UPDATE text_sentence_records
           SET words_count = ?, character_offset = ?, character_length = ?
           WHERE kind = ? AND chapter_id = ? AND sentence_index = ?`,
          [
            update.wordsCount,
            update.characterOffset,
            update.characterLength,
            update.kind,
            update.chapterId,
            update.sentenceIndex,
          ],
        );
      }
    });
  });
  return repairedTextWords;
}

function getTextStreamName(kind: number): "source" | "summary" | undefined {
  if (kind === TEXT_STREAM_KIND.source) return "source";
  if (kind === TEXT_STREAM_KIND.summary) return "summary";
  return undefined;
}

async function cleanupArchiveDerivedData(): Promise<void> {
  const cache = await getWikiGraphStorage().library.getDirectory("cache");
  if (cache !== undefined) {
    await cache.remove("search-sessions.sqlite").catch(() => undefined);
    await cache.remove("continuation-cursors.sqlite").catch(() => undefined);
  }
}

async function serializeArchiveUpgrade<T>(
  archive: File,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    archiveUpgradeQueues.get(archive.identity) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  archiveUpgradeQueues.set(archive.identity, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (archiveUpgradeQueues.get(archive.identity) === queued) {
      archiveUpgradeQueues.delete(archive.identity);
    }
  }
}

async function createWorkspaceName(root: Directory): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    workspaceSequence += 1;
    const name = `.wikg-upgrade-${Date.now().toString(36)}-${workspaceSequence.toString(36)}`;
    if ((await root.getDirectory(name)) === undefined) return name;
  }
  throw new Error("Could not allocate an archive upgrade workspace");
}

async function getOrCreateRelativeFile(
  root: Directory,
  path: string,
): Promise<File> {
  const parts = normalizeArchivePath(path).split("/");
  const name = parts.pop();
  if (!name) throw new TypeError(`Invalid archive entry: ${path}`);
  const parent = await ensureRelativeDirectory(root, parts.join("/"));
  return (await parent.getFile(name)) ?? (await parent.createFile(name));
}

async function replaceFile(
  file: File,
  content: string | Uint8Array,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    await writer.write(content);
    await writer.commit();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}
