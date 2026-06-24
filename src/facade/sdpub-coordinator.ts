import { createHash, randomUUID } from "crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, posix, resolve } from "path";

import { Database } from "../document/index.js";
import type { DocumentFileStore } from "../document/document.js";
import { AsyncSemaphore } from "../utils/async-semaphore.js";

import {
  extractSdpubArchive,
  readSdpubArchiveEntry,
  writeSdpubArchiveWithOverlays,
  type SdpubArchiveOverlay,
} from "./archive.js";

const STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);

CREATE TABLE IF NOT EXISTS entry_locks (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
  archive_key TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path, owner_id)
);

CREATE TABLE IF NOT EXISTS archive_commit_locks (
  archive_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const DATABASE_ENTRY_PATH = "database.db";
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_STALE_TIMEOUT_MS = 60_000;
const STATE_DATABASE_SEMAPHORE = new AsyncSemaphore(1);

type EntryLockMode = "read" | "state" | "write";

export class SdpubCoordinator {
  public createFileStore(
    archivePath: string,
    options: { readonly readonlyDatabase?: boolean } = {},
  ): DocumentFileStore {
    return new SdpubDocumentFileStore(resolve(archivePath), options);
  }

  public async withReadWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    const directoryPath =
      options.documentDirPath === undefined
        ? await mkdtemp(join(tmpdir(), "spinedigest-open-"))
        : resolve(options.documentDirPath);

    try {
      await extractSdpubArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      if (options.documentDirPath === undefined) {
        await rm(directoryPath, { force: true, recursive: true });
      }
    }
  }

  public async withWriteWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const directoryPath = await mkdtemp(join(tmpdir(), "spinedigest-write-"));

    try {
      await extractSdpubArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

export async function tryStartSdpubFlusher(): Promise<void> {
  const archiveKeys = await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT DISTINCT archive_key
FROM entry_overlays
ORDER BY archive_key
`,
      undefined,
      (row) => getString(row, "archive_key"),
    );
  });

  for (const archiveKey of archiveKeys) {
    await flushArchiveOverlays(archiveKey);
  }
}

class SdpubDocumentFileStore implements DocumentFileStore {
  readonly #archiveKey: string;
  readonly #archivePath: string;
  readonly #readonlyDatabase: boolean;
  readonly #sqliteLeaseOwnerId = createOwnerId();

  public constructor(
    archivePath: string,
    options: { readonly readonlyDatabase?: boolean },
  ) {
    this.#archivePath = resolve(archivePath);
    this.#archiveKey = createArchiveKey(this.#archivePath);
    this.#readonlyDatabase = options.readonlyDatabase === true;
  }

  public async close(): Promise<void> {
    await releaseSqliteLease({
      archiveKey: this.#archiveKey,
      entryPath: DATABASE_ENTRY_PATH,
      ownerId: this.#sqliteLeaseOwnerId,
    });
  }

  public async deleteFile(path: string): Promise<void> {
    const entryPath = this.#toEntryPath(path);

    await withEntryLock(this.#archiveKey, entryPath, "write", async () => {
      await withEntryLock(this.#archiveKey, entryPath, "state", async () => {
        const overlay = await readOverlay(this.#archiveKey, entryPath);

        if (overlay?.workspacePath !== undefined) {
          await rm(overlay.workspacePath, { force: true });
        }

        await upsertOverlay({
          archiveKey: this.#archiveKey,
          archivePath: this.#archivePath,
          entryPath,
          kind: "deleted",
        });
      });
    });
  }

  public async deleteTree(path: string): Promise<void> {
    const rootEntryPath = this.#toEntryPath(path);
    const entries = await listVisibleEntryPaths(this.#archivePath, {
      archiveKey: this.#archiveKey,
      prefix: `${rootEntryPath}/`,
    });

    for (const entryPath of entries) {
      await this.deleteFile(entryPath);
    }
  }

  public ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }

  public initializeDatabaseSchema(): boolean {
    return false;
  }

  public openDatabaseReadonly(): boolean {
    return this.#readonlyDatabase;
  }

  public async listFiles(path: string): Promise<readonly string[]> {
    const directoryEntryPath = this.#toEntryPath(path);
    const prefix = directoryEntryPath === "" ? "" : `${directoryEntryPath}/`;
    const entries = await listVisibleEntryPaths(this.#archivePath, {
      archiveKey: this.#archiveKey,
      prefix,
    });

    return entries
      .map((entryPath) => entryPath.slice(prefix.length))
      .filter((entryPath) => !entryPath.includes("/"))
      .map((entryPath) => posix.basename(entryPath))
      .sort((left, right) => left.localeCompare(right));
  }

  public async readFile(path: string): Promise<Uint8Array | undefined> {
    const entryPath = this.#toEntryPath(path);

    return await withEntryLock(
      this.#archiveKey,
      entryPath,
      "read",
      async () => {
        const source = await withEntryLock(
          this.#archiveKey,
          entryPath,
          "state",
          async () =>
            await resolveEntrySource({
              archiveKey: this.#archiveKey,
              entryPath,
            }),
        );

        if (source.kind === "deleted") {
          return undefined;
        }
        if (source.kind === "workspace") {
          return await readFile(source.path);
        }

        return await readSdpubArchiveEntry(this.#archivePath, entryPath);
      },
    );
  }

  public async resolveDatabasePath(): Promise<string> {
    return await withEntryLock(
      this.#archiveKey,
      DATABASE_ENTRY_PATH,
      "state",
      async () => {
        let overlay = await readOverlay(this.#archiveKey, DATABASE_ENTRY_PATH);

        if (overlay?.kind !== "file") {
          const workspacePath = await createWorkspaceFilePath(
            this.#archiveKey,
            DATABASE_ENTRY_PATH,
          );
          const content = await readSdpubArchiveEntry(
            this.#archivePath,
            DATABASE_ENTRY_PATH,
          );

          await mkdir(dirname(workspacePath), { recursive: true });
          await writeFile(workspacePath, content ?? new Uint8Array());
          await upsertOverlay({
            archiveKey: this.#archiveKey,
            archivePath: this.#archivePath,
            entryPath: DATABASE_ENTRY_PATH,
            kind: "file",
            workspacePath,
          });
          overlay = await readOverlay(this.#archiveKey, DATABASE_ENTRY_PATH);
        }

        if (overlay?.workspacePath === undefined) {
          throw new Error("Could not materialize SQLite database.");
        }

        await acquireSqliteLease({
          archiveKey: this.#archiveKey,
          entryPath: DATABASE_ENTRY_PATH,
          ownerId: this.#sqliteLeaseOwnerId,
        });
        return overlay.workspacePath;
      },
    );
  }

  public async writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void> {
    const entryPath = this.#toEntryPath(path);

    await withEntryLock(this.#archiveKey, entryPath, "write", async () => {
      const source = await withEntryLock(
        this.#archiveKey,
        entryPath,
        "state",
        async () =>
          await resolveEntrySource({
            archiveKey: this.#archiveKey,
            entryPath,
          }),
      );
      const archiveEntryExists =
        source.kind === "archive" &&
        (await readSdpubArchiveEntry(this.#archivePath, entryPath)) !==
          undefined;

      if (
        options.overwrite !== true &&
        (source.kind === "workspace" || archiveEntryExists)
      ) {
        throw new Error(`File already exists: ${path}`);
      }

      await withEntryLock(this.#archiveKey, entryPath, "state", async () => {
        const workspacePath =
          source.kind === "workspace"
            ? source.path
            : await createWorkspaceFilePath(this.#archiveKey, entryPath);

        await mkdir(dirname(workspacePath), { recursive: true });
        await writeFile(workspacePath, content);
        await upsertOverlay({
          archiveKey: this.#archiveKey,
          archivePath: this.#archivePath,
          entryPath,
          kind: "file",
          workspacePath,
        });
      });
    });
  }

  #toEntryPath(path: string): string {
    const resolvedPath = resolve(path);
    const rootPrefix = this.#archivePath.endsWith("/")
      ? this.#archivePath
      : `${this.#archivePath}/`;

    if (resolvedPath.startsWith(rootPrefix)) {
      return normalizeEntryPath(resolvedPath.slice(rootPrefix.length));
    }

    return normalizeEntryPath(path);
  }
}

async function flushArchiveOverlays(archiveKey: string): Promise<void> {
  const overlays = await listOverlays(archiveKey);
  const archivePath = await resolveArchivePathFromKey(archiveKey);

  if (overlays.length === 0 || archivePath === undefined) {
    return;
  }

  const entryPaths = overlays
    .map((overlay) => overlay.entryPath)
    .sort((left, right) => left.localeCompare(right));
  const releaseLocks: Array<() => Promise<void>> = [];

  try {
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "write"));
    }
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "state"));
    }

    if (entryPaths.includes(DATABASE_ENTRY_PATH)) {
      await waitForSqliteLeasesToDrain(archiveKey, DATABASE_ENTRY_PATH);
    }

    const currentOverlays = await listOverlays(archiveKey);

    if (currentOverlays.length === 0) {
      return;
    }

    const releaseCommit = await acquireArchiveCommitLock(archiveKey);

    try {
      const temporaryDirectoryPath = await mkdtemp(
        join(tmpdir(), "spinedigest-flush-"),
      );
      const temporaryArchivePath = join(
        temporaryDirectoryPath,
        basename(archivePath),
      );

      try {
        await writeSdpubArchiveWithOverlays(
          archivePath,
          temporaryArchivePath,
          currentOverlays.map(toArchiveOverlay),
        );
        await mkdir(dirname(archivePath), { recursive: true });
        await rename(temporaryArchivePath, archivePath);
      } finally {
        await rm(temporaryDirectoryPath, { force: true, recursive: true });
      }
    } finally {
      await releaseCommit();
    }

    for (const overlay of currentOverlays) {
      if (overlay.workspacePath !== undefined) {
        await rm(overlay.workspacePath, { force: true });
      }
      await deleteOverlay(archiveKey, overlay.entryPath);
    }
  } finally {
    for (const release of releaseLocks.reverse()) {
      await release();
    }
  }
}

async function acquireArchiveCommitLock(
  archiveKey: string,
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const existing = await state.queryOne(
          "SELECT * FROM archive_commit_locks WHERE archive_key = ?",
          [archiveKey],
          mapArchiveCommitLock,
        );

        if (existing !== undefined) {
          return false;
        }

        await state.run(
          `
INSERT INTO archive_commit_locks (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
          [archiveKey, ownerId, process.pid, Date.now(), Date.now()],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
            [archiveKey, ownerId],
          );
        });
      };
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function acquireEntryLock(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
): Promise<() => Promise<void>> {
  const ownerId = createOwnerId();

  while (true) {
    const acquired = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.transaction(async () => {
        const conflicts = await state.queryAll(
          `
SELECT *
FROM entry_locks
WHERE archive_key = ? AND entry_path = ?
`,
          [archiveKey, entryPath],
          mapEntryLock,
        );

        if (
          conflicts.some(
            (lock) =>
              lock.ownerId !== ownerId && locksConflict(mode, lock.mode),
          )
        ) {
          return false;
        }

        await state.run(
          `
INSERT INTO entry_locks (
  archive_key, entry_path, mode, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
          [
            archiveKey,
            entryPath,
            mode,
            ownerId,
            process.pid,
            Date.now(),
            Date.now(),
          ],
        );
        return true;
      });
    });

    if (acquired) {
      return async () => {
        await withStateDatabase(async (releaseState) => {
          await releaseState.run(
            `
DELETE FROM entry_locks
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
            [archiveKey, entryPath, ownerId],
          );
        });
      };
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function withEntryLock<T>(
  archiveKey: string,
  entryPath: string,
  mode: EntryLockMode,
  operation: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireEntryLock(archiveKey, entryPath, mode);

  try {
    return await operation();
  } finally {
    await release();
  }
}

function locksConflict(requested: EntryLockMode, existing: EntryLockMode) {
  if (requested === "state" || existing === "state") {
    return requested === "state" && existing === "state";
  }
  if (requested === "read" && existing === "read") {
    return false;
  }

  return true;
}

async function acquireSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    await state.run(
      `
INSERT OR REPLACE INTO entry_sqlite_leases (
  archive_key, entry_path, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
      [
        input.archiveKey,
        input.entryPath,
        input.ownerId,
        process.pid,
        Date.now(),
        Date.now(),
      ],
    );
  });
}

async function releaseSqliteLease(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
  readonly ownerId: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      `
DELETE FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ? AND owner_id = ?
`,
      [input.archiveKey, input.entryPath, input.ownerId],
    );
  });
}

async function waitForSqliteLeasesToDrain(
  archiveKey: string,
  entryPath: string,
): Promise<void> {
  while (true) {
    const count = await withStateDatabase(async (state) => {
      await cleanupStaleState(state);
      return await state.queryOne(
        `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ? AND entry_path = ?
`,
        [archiveKey, entryPath],
        (row) => getNumber(row, "count"),
      );
    });

    if (count === 0) {
      return;
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }
}

async function listVisibleEntryPaths(
  archivePath: string,
  input: { readonly archiveKey: string; readonly prefix: string },
): Promise<readonly string[]> {
  const archiveEntries = await listArchiveEntryPathsByPrefix(
    archivePath,
    input.prefix,
  );
  const overlays = await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
`,
        [input.archiveKey],
        mapEntryOverlay,
      ),
  );
  const entries = new Set(archiveEntries);

  for (const overlay of overlays) {
    if (!overlay.entryPath.startsWith(input.prefix)) {
      continue;
    }
    if (overlay.kind === "deleted") {
      entries.delete(overlay.entryPath);
    } else {
      entries.add(overlay.entryPath);
    }
  }

  return [...entries].sort((left, right) => left.localeCompare(right));
}

async function listArchiveEntryPathsByPrefix(
  archivePath: string,
  prefix: string,
): Promise<readonly string[]> {
  const { listSdpubArchiveEntries } = await import("./archive.js");

  return (await listSdpubArchiveEntries(archivePath)).filter((entryPath) =>
    entryPath.startsWith(prefix),
  );
}

async function resolveEntrySource(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
}): Promise<
  | { readonly kind: "archive" }
  | { readonly kind: "deleted" }
  | { readonly kind: "workspace"; readonly path: string }
> {
  const overlay = await readOverlay(input.archiveKey, input.entryPath);

  if (overlay?.kind === "deleted") {
    return { kind: "deleted" };
  }
  if (overlay?.workspacePath !== undefined) {
    return { kind: "workspace", path: overlay.workspacePath };
  }
  return { kind: "archive" };
}

async function readOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<EntryOverlay | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [archiveKey, entryPath],
        mapEntryOverlay,
      ),
  );
}

async function listOverlays(
  archiveKey: string,
): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
ORDER BY entry_path ASC
`,
        [archiveKey],
        mapEntryOverlay,
      ),
  );
}

async function upsertOverlay(input: {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly workspacePath?: string;
}): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(archive_key, entry_path)
DO UPDATE SET kind = excluded.kind,
              archive_path = excluded.archive_path,
              workspace_path = excluded.workspace_path,
              updated_at = excluded.updated_at
`,
      [
        input.archiveKey,
        input.archivePath,
        input.entryPath,
        input.kind,
        input.workspacePath ?? null,
        Date.now(),
      ],
    );
  });
}

async function deleteOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [archiveKey, entryPath],
    );
  });
}

async function resolveArchivePathFromKey(
  archiveKey: string,
): Promise<string | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT archive_path FROM entry_overlays WHERE archive_key = ? LIMIT 1",
        [archiveKey],
        (row) => getString(row, "archive_path"),
      ),
  );
}

async function cleanupStaleState(state: Database): Promise<void> {
  const now = Date.now();

  await state.run(
    `
DELETE FROM entry_locks
WHERE owner_pid IS NOT NULL
  AND heartbeat_at <= ?
`,
    [now - LOCK_STALE_TIMEOUT_MS],
  );
  await state.run(
    `
DELETE FROM entry_sqlite_leases
WHERE owner_pid IS NOT NULL
  AND heartbeat_at <= ?
`,
    [now - LOCK_STALE_TIMEOUT_MS],
  );
  await state.run(
    `
DELETE FROM archive_commit_locks
WHERE owner_pid IS NOT NULL
  AND heartbeat_at <= ?
`,
    [now - LOCK_STALE_TIMEOUT_MS],
  );
}

async function withStateDatabase<T>(
  operation: (state: Database) => Promise<T> | T,
): Promise<T> {
  return await STATE_DATABASE_SEMAPHORE.use(async () => {
    const state = await openStateDatabase();

    try {
      return await operation(state);
    } finally {
      await state.close();
    }
  });
}

async function openStateDatabase(): Promise<Database> {
  const directoryPath = getCoordinatorStateDirectoryPath();

  await mkdir(directoryPath, { recursive: true });
  return await Database.open(
    join(directoryPath, "state.sqlite"),
    STATE_SCHEMA_SQL,
  );
}

async function createWorkspaceFilePath(
  archiveKey: string,
  entryPath: string,
): Promise<string> {
  const directoryPath = join(
    getCoordinatorStateDirectoryPath(),
    "workspaces",
    archiveKey,
    dirname(entryPath),
  );

  await mkdir(directoryPath, { recursive: true });
  return join(directoryPath, `${basename(entryPath)}.${randomUUID()}`);
}

function toArchiveOverlay(overlay: EntryOverlay): SdpubArchiveOverlay {
  if (overlay.kind === "deleted") {
    return {
      entryPath: overlay.entryPath,
      kind: "deleted",
    };
  }
  if (overlay.workspacePath === undefined) {
    throw new Error(`Missing workspace path for ${overlay.entryPath}.`);
  }

  return {
    entryPath: overlay.entryPath,
    kind: "file",
    workspacePath: overlay.workspacePath,
  };
}

function normalizeEntryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/u, "");
}

function getCoordinatorStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.SPINEDIGEST_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return join(homedir(), ".spinedigest", "state");
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

function createOwnerId(): string {
  return `${process.pid}-${randomUUID()}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

interface EntryOverlay {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly workspacePath?: string;
}

interface EntryLock {
  readonly mode: EntryLockMode;
  readonly ownerId: string;
}

interface ArchiveCommitLock {
  readonly ownerId: string;
}

function mapEntryOverlay(row: Record<string, unknown>): EntryOverlay {
  const workspacePath = getOptionalString(row, "workspace_path");

  return {
    archiveKey: getString(row, "archive_key"),
    archivePath: getString(row, "archive_path"),
    entryPath: getString(row, "entry_path"),
    kind: getOverlayKind(row),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  };
}

function mapEntryLock(row: Record<string, unknown>): EntryLock {
  return {
    mode: getEntryLockMode(row),
    ownerId: getString(row, "owner_id"),
  };
}

function mapArchiveCommitLock(row: Record<string, unknown>): ArchiveCommitLock {
  return {
    ownerId: getString(row, "owner_id"),
  };
}

function getEntryLockMode(row: Record<string, unknown>): EntryLockMode {
  const mode = getString(row, "mode");

  if (mode === "read" || mode === "state" || mode === "write") {
    return mode;
  }

  throw new Error(`Unsupported entry lock mode: ${mode}.`);
}

function getOverlayKind(row: Record<string, unknown>): "deleted" | "file" {
  const kind = getString(row, "kind");

  if (kind === "deleted" || kind === "file") {
    return kind;
  }

  throw new Error(`Unsupported entry overlay kind: ${kind}.`);
}

function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}
