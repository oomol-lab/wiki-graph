import {
  ensureRelativeFile,
  getRelativeFile,
  getWikiGraphPlatform,
  getWikiGraphStorage,
  isHostFileEmpty,
  isDirectory,
  type Directory,
  type File,
} from "../runtime/platform/index.js";
import { isHostError } from "../utils/host-error.js";
import { getNumber, getString, Database } from "./database.js";

const CURRENT_HOME_SCHEMA_VERSION = 4;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;
const HOME_UPGRADE_RECOVERY =
  "Stop the active operation, then run `wg maintenance upgrade home`. See: `wg maintenance upgrade --help`.";
const HOME_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    scope TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const homeSchemaUpgradesInFlight = new Map<string, Promise<void>>();

export async function ensureWikiGraphHomeSchemaCurrent(): Promise<void> {
  const root = getWikiGraphStorage().library;
  const existingUpgrade = homeSchemaUpgradesInFlight.get(root.identity);
  if (existingUpgrade !== undefined) {
    await existingUpgrade;
    return;
  }

  const upgrade = upgradeHomeSchema(root);
  homeSchemaUpgradesInFlight.set(root.identity, upgrade);
  try {
    await upgrade;
  } finally {
    if (homeSchemaUpgradesInFlight.get(root.identity) === upgrade) {
      homeSchemaUpgradesInFlight.delete(root.identity);
    }
  }
}

export async function readWikiGraphHomeSchemaVersion(): Promise<number> {
  const file = await getRelativeFile(
    getWikiGraphStorage().library,
    "core.sqlite",
  );
  if (file === undefined || (await isEmpty(file))) return 0;
  const database = await Database.open(file, "", { readonly: true });
  try {
    if (!(await tableExists(database, "schema_versions"))) return 1;
    return (
      (await database.queryOne(
        "SELECT version FROM schema_versions WHERE scope = ?",
        ["home"],
        (row) => getNumber(row, "version"),
      )) ?? 1
    );
  } finally {
    await database.close();
  }
}

async function upgradeHomeSchema(root: Directory): Promise<void> {
  let version = await readWikiGraphHomeSchemaVersion();
  if (version > CURRENT_HOME_SCHEMA_VERSION) {
    throw new Error(`Unsupported Wiki Graph home schema version: ${version}.`);
  }

  const file = await ensureRelativeFile(root, "core.sqlite");
  if (version === 0) {
    await writeHomeSchemaVersion(file, CURRENT_HOME_SCHEMA_VERSION);
    return;
  }

  while (version < CURRENT_HOME_SCHEMA_VERSION) {
    switch (version) {
      case 1:
        await upgradeLegacyHomeSchema(root);
        await writeHomeSchemaVersion(file, 2);
        version = 2;
        break;
      case 2:
        await upgradeLegacyHomeSchema(root);
        await writeHomeSchemaVersion(file, 3);
        version = 3;
        break;
      case 3:
        await upgradeHomeSchemaFromV3ToV4(file);
        await writeHomeSchemaVersion(file, 4);
        version = 4;
        break;
      default:
        throw new Error(
          `Unsupported Wiki Graph home schema version: ${version}.`,
        );
    }
  }
}

async function upgradeLegacyHomeSchema(root: Directory): Promise<void> {
  await assertHomeUpgradeSafe(root);
  await cleanupHomeDerivedData(root);
}

/** The only v3 -> v4 migration. Keep all v3 interpretation inside this gate. */
async function upgradeHomeSchemaFromV3ToV4(file: File): Promise<void> {
  const root = getWikiGraphStorage().library;
  await assertHomeUpgradeSafe(root);
  await migrateLibraryDirectoryIdentities(file);
  await cleanupHomeDerivedData(root);
}

async function migrateLibraryDirectoryIdentities(file: File): Promise<void> {
  const database = await Database.open(file);
  try {
    if (!(await tableExists(database, "libraries"))) return;
    const columns = await readTableColumns(database, "libraries");
    const sourceColumn = columns.has("folder_identity")
      ? "folder_identity"
      : columns.has("folder_path")
        ? "folder_path"
        : undefined;
    if (sourceColumn === undefined) {
      throw new Error(
        "Cannot migrate library registry without a folder reference.",
      );
    }

    const rows = await database.queryAll(
      `SELECT id, ${sourceColumn} AS folder_reference FROM libraries ORDER BY id`,
      undefined,
      (row) => ({
        id: getNumber(row, "id"),
        reference: getString(row, "folder_reference"),
      }),
    );
    const migrated: Array<{ readonly id: number; readonly identity: string }> =
      [];
    for (const row of rows) {
      const resources = getWikiGraphPlatform().resources;
      const directory =
        sourceColumn === "folder_identity" ||
        resources.resolveLegacyDirectory === undefined
          ? await resources.getDirectory(row.reference)
          : await resources.resolveLegacyDirectory(row.reference);
      if (directory === undefined) {
        throw new Error(
          `Cannot migrate unavailable library Directory for registry id ${row.id}.`,
        );
      }
      migrated.push({ id: row.id, identity: directory.identity });
    }

    await database.transaction(async () => {
      if (!columns.has("folder_identity")) {
        await database.run(
          "ALTER TABLE libraries RENAME COLUMN folder_path TO folder_identity",
        );
      }
      for (const row of migrated) {
        await database.run(
          "UPDATE libraries SET folder_identity = ? WHERE id = ?",
          [row.identity, row.id],
        );
      }
    });
  } finally {
    await database.close();
  }
}

async function writeHomeSchemaVersion(
  file: File,
  version: number,
): Promise<void> {
  const database = await Database.open(file);
  try {
    await database.execute(HOME_SCHEMA_SQL);
    await database.run(
      `INSERT INTO schema_versions (scope, version, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET
         version = excluded.version,
         updated_at = excluded.updated_at`,
      ["home", version, new Date().toISOString()],
    );
  } finally {
    await database.close();
  }
}

async function cleanupHomeDerivedData(root: Directory): Promise<void> {
  await removeKnownChildren(await root.getDirectory("cache"), [
    "search-sessions.sqlite",
    "continuation-cursors.sqlite",
    "cache.sqlite",
  ]);

  const staging = await root.getDirectory("staging");
  await removeKnownChildren(staging, ["library", "work"]);
  await removeSqlite(staging, "staging.sqlite");

  const temporary = await root.getDirectory("tmp");
  await removeSqlite(temporary, "gc.sqlite");
  await removeSqlite(temporary, "wikg-coordinator.sqlite");
  await removeKnownChildren(temporary, ["gc.last-run"]);

  const jobs = await root.getDirectory("jobs");
  await removeKnownChildren(jobs, ["cache", "work"]);
  await removeSqlite(jobs, "job.sqlite");

  const documentStore = getWikiGraphStorage().documentStore;
  let documentStoreEntries: ReadonlyArray<File | Directory>;
  try {
    documentStoreEntries = await documentStore.list();
  } catch (error) {
    if (isHostError(error) && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of documentStoreEntries) {
    if (
      entry.name === ".wikg-work" ||
      entry.name === ".wikg-cache" ||
      entry.name.startsWith(".wikg-session-") ||
      entry.name.startsWith(".wikg-upgrade-")
    ) {
      await documentStore.remove(entry.name, { recursive: isDirectory(entry) });
    }
  }
}

async function removeSqlite(
  directory: Directory | undefined,
  name: string,
): Promise<void> {
  await removeKnownChildren(directory, [name, `${name}-wal`, `${name}-shm`]);
}

async function removeKnownChildren(
  directory: Directory | undefined,
  names: readonly string[],
): Promise<void> {
  if (directory === undefined) return;
  const entries = new Map(
    (await directory.list()).map((entry) => [entry.name, entry]),
  );
  for (const name of names) {
    const entry = entries.get(name);
    if (entry !== undefined) {
      await directory.remove(name, { recursive: isDirectory(entry) });
    }
  }
}

async function assertHomeUpgradeSafe(root: Directory): Promise<void> {
  await assertNoFreshRows(await getRelativeFile(root, "core.sqlite"), [
    ["library_locks", "Cannot upgrade home with active library locks."],
    ["state_locks", "Cannot upgrade home with active state locks."],
  ]);
  await assertNoFreshRows(await getRelativeFile(root, "tmp/gc.sqlite"), [
    ["gc_locks", "Cannot upgrade home with an active GC lock."],
  ]);
  await assertBuildQueueSafe(await getRelativeFile(root, "jobs/job.sqlite"));
  await assertCoordinatorInactive(
    await getRelativeFile(root, "staging/staging.sqlite"),
    "legacy coordinator",
  );
  await assertCoordinatorInactive(
    await getRelativeFile(root, "tmp/wikg-coordinator.sqlite"),
    "coordinator",
  );
}

async function assertBuildQueueSafe(file: File | undefined): Promise<void> {
  if (file === undefined || (await isEmpty(file))) return;
  const database = await Database.open(file, "", { readonly: true });
  try {
    if (await tableExists(database, "build_worker_lease")) {
      const columns = await readTableColumns(database, "build_worker_lease");
      const ownerColumns = ["owner_id", "owner_pid"].filter((name) =>
        columns.has(name),
      );
      const ownerPredicate = ownerColumns
        .map((name) => `${name} IS NOT NULL`)
        .join(" OR ");
      const active = await database.queryOne(
        `SELECT 1 AS active FROM build_worker_lease
         WHERE heartbeat_at IS NOT NULL
           AND heartbeat_at >= ?
           ${ownerPredicate === "" ? "" : `AND (${ownerPredicate})`}
         LIMIT 1`,
        [Date.now() - LOCK_STALE_TIMEOUT_MS],
        () => true,
      );
      if (active === true) {
        throw homeUpgradeBlocked(
          "Cannot upgrade home with an active build worker.",
        );
      }
    }
  } finally {
    await database.close();
  }
}

async function assertCoordinatorInactive(
  file: File | undefined,
  label: string,
): Promise<void> {
  if (file === undefined || (await isEmpty(file))) return;
  const database = await Database.open(file, "", { readonly: true });
  try {
    if (await tableExists(database, "archive_owners")) {
      const columns = await readTableColumns(database, "archive_owners");
      const owners = await database.queryAll(
        `SELECT heartbeat_at${columns.has("host_instance_id") ? ", host_instance_id" : ""}
         FROM archive_owners`,
        undefined,
        (row) => ({
          heartbeatAt: getNumber(row, "heartbeat_at"),
          hostInstanceId:
            typeof row.host_instance_id === "string"
              ? row.host_instance_id
              : undefined,
        }),
      );
      for (const owner of owners) {
        if (owner.hostInstanceId === undefined) {
          if (isFresh(owner.heartbeatAt)) {
            throw homeUpgradeBlocked(
              `Cannot upgrade home with active ${label} state.`,
            );
          }
          continue;
        }
        const alive = await getWikiGraphPlatform().lifecycle.isInstanceAlive(
          owner.hostInstanceId,
        );
        if (
          alive === true ||
          (alive === undefined && isFresh(owner.heartbeatAt))
        ) {
          throw homeUpgradeBlocked(
            `Cannot upgrade home with active ${label} state.`,
          );
        }
      }
    }

    for (const table of [
      "entry_locks",
      "entry_sqlite_leases",
      "archive_commit_locks",
    ]) {
      if (!(await tableExists(database, table))) continue;
      const columns = await readTableColumns(database, table);
      if (!columns.has("heartbeat_at")) continue;
      const active = await database.queryOne(
        `SELECT 1 AS active FROM ${table} WHERE heartbeat_at >= ? LIMIT 1`,
        [Date.now() - LOCK_STALE_TIMEOUT_MS],
        () => true,
      );
      if (active === true) {
        throw homeUpgradeBlocked(
          `Cannot upgrade home with active ${label} state.`,
        );
      }
    }
  } finally {
    await database.close();
  }
}

async function assertNoFreshRows(
  file: File | undefined,
  tables: readonly (readonly [string, string])[],
): Promise<void> {
  if (file === undefined || (await isEmpty(file))) return;
  const database = await Database.open(file, "", { readonly: true });
  try {
    for (const [table, message] of tables) {
      if (!(await tableExists(database, table))) continue;
      const active = await database.queryOne(
        `SELECT 1 AS active FROM ${table} WHERE heartbeat_at >= ? LIMIT 1`,
        [Date.now() - LOCK_STALE_TIMEOUT_MS],
        () => true,
      );
      if (active === true) throw homeUpgradeBlocked(message);
    }
  } finally {
    await database.close();
  }
}

function homeUpgradeBlocked(message: string): Error {
  return new Error(`${message} ${HOME_UPGRADE_RECOVERY}`);
}

function isFresh(heartbeat: number | undefined): boolean {
  return (
    heartbeat !== undefined && Date.now() - heartbeat <= LOCK_STALE_TIMEOUT_MS
  );
}

async function isEmpty(file: File): Promise<boolean> {
  return await isHostFileEmpty(file);
}

async function readTableColumns(
  database: Database,
  name: string,
): Promise<ReadonlySet<string>> {
  return new Set(
    await database.queryAll(`PRAGMA table_info(${name})`, undefined, (row) =>
      getString(row, "name"),
    ),
  );
}

async function tableExists(database: Database, name: string): Promise<boolean> {
  return (
    (await database.queryOne(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
      () => true,
    )) === true
  );
}
