import { createHash, randomUUID } from "crypto";
import { mkdir, mkdtemp, rename, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";

import { Database } from "../document/index.js";

import { extractSdpubArchive, writeSdpubArchive } from "./archive.js";

const STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS archives (
  archive_key TEXT PRIMARY KEY,
  archive_path TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0,
  flushable INTEGER NOT NULL DEFAULT 0,
  operation_owner TEXT,
  operation_pid INTEGER,
  operation_heartbeat_at INTEGER,
  flusher_owner TEXT,
  flusher_pid INTEGER,
  flusher_heartbeat_at INTEGER,
  updated_at INTEGER NOT NULL
);
`;

const FLUSH_HEARTBEAT_INTERVAL_MS = 5_000;

export class SdpubCoordinator {
  public async openSession<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    if (options.documentDirPath !== undefined) {
      const directoryPath = resolve(options.documentDirPath);

      await extractSdpubArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    }

    const entry = await this.#getArchiveEntry(resolve(archivePath));

    if (entry !== undefined) {
      return await operation(entry.workspacePath);
    }

    const directoryPath = await mkdtemp(join(tmpdir(), "spinedigest-open-"));

    try {
      await extractSdpubArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }

  public async openEditableSession<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const resolvedArchivePath = resolve(archivePath);
    const ownerId = createOwnerId();
    const archiveKey = createArchiveKey(resolvedArchivePath);
    const workspacePath = await this.#prepareWorkspace({
      archiveKey,
      archivePath: resolvedArchivePath,
      ownerId,
    });

    let completed = false;

    try {
      const result = await operation(workspacePath);

      await this.#markFlushable(archiveKey);
      completed = true;
      return result;
    } finally {
      await this.#releaseOperation(archiveKey, ownerId, completed);
      if (completed) {
        await tryStartSdpubFlusher();
      }
    }
  }

  async #prepareWorkspace(input: {
    readonly archiveKey: string;
    readonly archivePath: string;
    readonly ownerId: string;
  }): Promise<string> {
    const state = await openStateDatabase();

    try {
      await cleanupStaleState(state);

      return await state.transaction(async () => {
        const now = Date.now();
        const existing = await readArchiveState(state, input.archiveKey);

        if (
          existing?.operationOwner !== undefined &&
          existing.operationPid !== undefined &&
          isProcessAlive(existing.operationPid)
        ) {
          throw new Error(
            `Archive is already being edited by process ${existing.operationPid}: ${input.archivePath}`,
          );
        }

        if (existing !== undefined) {
          await state.run(
            `
UPDATE archives
SET operation_owner = ?, operation_pid = ?, operation_heartbeat_at = ?,
    dirty = 1, flushable = 0, archive_path = ?, updated_at = ?
WHERE archive_key = ?
`,
            [
              input.ownerId,
              process.pid,
              now,
              input.archivePath,
              now,
              input.archiveKey,
            ],
          );
          return existing.workspacePath;
        }

        const workspacePath = await createWorkspacePath(input.archiveKey);

        await extractSdpubArchive(input.archivePath, workspacePath);
        await state.run(
          `
INSERT INTO archives (
  archive_key, archive_path, workspace_path, dirty, flushable,
  operation_owner, operation_pid, operation_heartbeat_at, updated_at
) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)
`,
          [
            input.archiveKey,
            input.archivePath,
            workspacePath,
            input.ownerId,
            process.pid,
            now,
            now,
          ],
        );
        return workspacePath;
      });
    } finally {
      await state.close();
    }
  }

  async #markFlushable(archiveKey: string): Promise<void> {
    const state = await openStateDatabase();

    try {
      await state.run(
        `
UPDATE archives
SET flushable = 1, updated_at = ?
WHERE archive_key = ? AND dirty = 1
`,
        [Date.now(), archiveKey],
      );
    } finally {
      await state.close();
    }
  }

  async #releaseOperation(
    archiveKey: string,
    ownerId: string,
    completed: boolean,
  ): Promise<void> {
    const state = await openStateDatabase();

    try {
      await state.run(
        `
UPDATE archives
SET operation_owner = NULL, operation_pid = NULL, operation_heartbeat_at = NULL,
    flushable = CASE WHEN ? = 1 THEN flushable ELSE 0 END,
    updated_at = ?
WHERE archive_key = ? AND operation_owner = ?
`,
        [completed ? 1 : 0, Date.now(), archiveKey, ownerId],
      );
    } finally {
      await state.close();
    }
  }

  async #getArchiveEntry(
    archivePath: string,
  ): Promise<{ readonly workspacePath: string } | undefined> {
    const state = await openStateDatabase();

    try {
      await cleanupStaleState(state);
      const archiveKey = createArchiveKey(archivePath);
      const entry = await readArchiveState(state, archiveKey);

      if (entry === undefined) {
        return undefined;
      }

      return { workspacePath: entry.workspacePath };
    } finally {
      await state.close();
    }
  }
}

export async function tryStartSdpubFlusher(): Promise<void> {
  const state = await openStateDatabase();
  const ownerId = createOwnerId();

  try {
    await cleanupStaleState(state);

    const acquired = await state.transaction(async () => {
      const running = await state.queryOne(
        `
SELECT flusher_pid
FROM archives
WHERE flusher_pid IS NOT NULL
LIMIT 1
`,
        undefined,
        (row) => getNumber(row, "flusher_pid"),
      );

      if (running !== undefined && isProcessAlive(running)) {
        return false;
      }

      const now = Date.now();

      await state.run(
        `
UPDATE archives
SET flusher_owner = ?, flusher_pid = ?, flusher_heartbeat_at = ?
WHERE dirty = 1 AND flushable = 1
`,
        [ownerId, process.pid, now],
      );
      return true;
    });

    if (!acquired) {
      return;
    }

    await runSdpubFlusher({ ownerId });
  } finally {
    await state.close();
  }
}

async function runSdpubFlusher(input: { readonly ownerId: string }) {
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const state = await openStateDatabase();
  const heartbeat = setInterval(() => {
    void heartbeatFlusher(input.ownerId).catch(() => undefined);
  }, FLUSH_HEARTBEAT_INTERVAL_MS);
  let lastWorkAt = Date.now();

  try {
    while (!stopping) {
      await heartbeatFlusher(input.ownerId, state);
      const candidate = await selectFlushCandidate(state, input.ownerId);

      if (candidate === undefined) {
        if (Date.now() - lastWorkAt >= getFlushIdleTimeoutMs()) {
          break;
        }
        await delay(500);
        continue;
      }

      lastWorkAt = Date.now();
      await flushArchive(candidate);
      await markFlushed(state, candidate.archiveKey);
    }
  } finally {
    clearInterval(heartbeat);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await releaseFlusher(input.ownerId, state);
    await state.close();
  }
}

async function selectFlushCandidate(
  state: Database,
  ownerId: string,
): Promise<ArchiveState | undefined> {
  return await state.queryOne(
    `
SELECT *
FROM archives
WHERE dirty = 1
  AND flushable = 1
  AND operation_owner IS NULL
  AND flusher_owner = ?
  AND updated_at <= ?
ORDER BY updated_at ASC
LIMIT 1
`,
    [ownerId, Date.now() - getFlushQuietPeriodMs()],
    mapArchiveState,
  );
}

async function flushArchive(archive: ArchiveState): Promise<void> {
  const temporaryDirectoryPath = await mkdtemp(
    join(tmpdir(), "spinedigest-flush-"),
  );
  const temporaryArchivePath = join(
    temporaryDirectoryPath,
    basename(archive.archivePath),
  );

  try {
    await writeSdpubArchive(archive.workspacePath, temporaryArchivePath);
    await mkdir(dirname(archive.archivePath), { recursive: true });
    await rename(temporaryArchivePath, archive.archivePath);
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
}

async function markFlushed(state: Database, archiveKey: string): Promise<void> {
  const archive = await readArchiveState(state, archiveKey);

  if (archive === undefined) {
    return;
  }

  await state.run(
    `
UPDATE archives
SET dirty = 0, flushable = 0, updated_at = ?
WHERE archive_key = ?
`,
    [Date.now(), archiveKey],
  );

  await rm(archive.workspacePath, { force: true, recursive: true });
  await state.run("DELETE FROM archives WHERE archive_key = ?", [archiveKey]);
}

async function heartbeatFlusher(
  ownerId: string,
  existingState?: Database,
): Promise<void> {
  const state = existingState ?? (await openStateDatabase());

  try {
    await state.run(
      `
UPDATE archives
SET flusher_heartbeat_at = ?
WHERE flusher_owner = ?
`,
      [Date.now(), ownerId],
    );
  } finally {
    if (existingState === undefined) {
      await state.close();
    }
  }
}

async function releaseFlusher(
  ownerId: string,
  existingState?: Database,
): Promise<void> {
  const state = existingState ?? (await openStateDatabase());

  try {
    await state.run(
      `
UPDATE archives
SET flusher_owner = NULL, flusher_pid = NULL, flusher_heartbeat_at = NULL
WHERE flusher_owner = ?
`,
      [ownerId],
    );
  } finally {
    if (existingState === undefined) {
      await state.close();
    }
  }
}

async function cleanupStaleState(state: Database): Promise<void> {
  const rows = await state.queryAll(
    "SELECT * FROM archives",
    undefined,
    mapArchiveState,
  );

  for (const row of rows) {
    if (row.operationPid !== undefined && !isProcessAlive(row.operationPid)) {
      await state.run(
        `
UPDATE archives
SET operation_owner = NULL, operation_pid = NULL,
    operation_heartbeat_at = NULL, flushable = 0, updated_at = ?
WHERE archive_key = ?
`,
        [Date.now(), row.archiveKey],
      );
    }

    if (row.flusherPid !== undefined && !isProcessAlive(row.flusherPid)) {
      await releaseFlusher(row.flusherOwner ?? "", state);
    }
  }
}

async function readArchiveState(
  state: Database,
  archiveKey: string,
): Promise<ArchiveState | undefined> {
  return await state.queryOne(
    "SELECT * FROM archives WHERE archive_key = ?",
    [archiveKey],
    mapArchiveState,
  );
}

async function openStateDatabase(): Promise<Database> {
  const directoryPath = getCoordinatorStateDirectoryPath();

  await mkdir(directoryPath, { recursive: true });
  return await Database.open(
    join(directoryPath, "state.sqlite"),
    STATE_SCHEMA_SQL,
  );
}

async function createWorkspacePath(archiveKey: string): Promise<string> {
  const rootPath = join(
    getCoordinatorStateDirectoryPath(),
    "workspaces",
    archiveKey,
  );

  await mkdir(rootPath, { recursive: true });
  return await mkdtemp(join(rootPath, "materialized-"));
}

function getCoordinatorStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.SPINEDIGEST_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return join(homedir(), ".spinedigest", "state");
}

function getFlushQuietPeriodMs(): number {
  return parseNonNegativeIntegerEnv(
    process.env.SPINEDIGEST_FLUSH_QUIET_PERIOD_MS,
    10_000,
  );
}

function getFlushIdleTimeoutMs(): number {
  return parseNonNegativeIntegerEnv(
    process.env.SPINEDIGEST_FLUSH_IDLE_TIMEOUT_MS,
    10_000,
  );
}

function parseNonNegativeIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

function createOwnerId(): string {
  return `${process.pid}-${randomUUID()}`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

interface ArchiveState {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly workspacePath: string;
  readonly operationOwner?: string;
  readonly operationPid?: number;
  readonly flusherOwner?: string;
  readonly flusherPid?: number;
}

function mapArchiveState(row: Record<string, unknown>): ArchiveState {
  const operationOwner = getOptionalString(row, "operation_owner");
  const operationPid = getOptionalNumber(row, "operation_pid");
  const flusherOwner = getOptionalString(row, "flusher_owner");
  const flusherPid = getOptionalNumber(row, "flusher_pid");

  return {
    archiveKey: getString(row, "archive_key"),
    archivePath: getString(row, "archive_path"),
    workspacePath: getString(row, "workspace_path"),
    ...(operationOwner === undefined ? {} : { operationOwner }),
    ...(operationPid === undefined ? {} : { operationPid }),
    ...(flusherOwner === undefined ? {} : { flusherOwner }),
    ...(flusherPid === undefined ? {} : { flusherPid }),
  };
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

function getOptionalNumber(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}
