import {
  ensureRelativeFile,
  getWikiGraphStorage,
  resolveHostFile,
  type File,
  type HostDatabaseOpenOptions,
} from "../runtime/platform/index.js";
import { ensureWikiGraphHomeSchemaCurrent } from "./home-schema-upgrade.js";
import { Database } from "./database.js";

/** Open a state database rooted below the host-provided library directory. */
export async function openWikiGraphStateDatabase(
  relativeName: string,
  schemaSql: string,
  options: HostDatabaseOpenOptions = {
    create: true,
    mode: "readwrite",
  },
): Promise<Database> {
  await ensureWikiGraphHomeSchemaCurrent();
  const file = await ensureRelativeFile(
    getWikiGraphStorage().library,
    relativeName,
  );
  return await openSharedStateDatabase(file, schemaSql, options);
}

/** Open a host File as an idempotently initialized shared SQLite database. */
export async function openSharedStateDatabase(
  fileRef: File | string,
  schemaSql: string,
  options: HostDatabaseOpenOptions = {
    create: true,
    mode: "readwrite",
  },
): Promise<Database> {
  return await Database.open(
    await resolveHostFile(fileRef),
    schemaSql,
    options,
  );
}

/** Initialize a host File without exposing its backing location to Core. */
export async function ensureSharedStateDatabaseInitialized(
  fileRef: File | string,
  schemaSql: string,
): Promise<void> {
  await Database.initialize(await resolveHostFile(fileRef), schemaSql);
}
