import {
  ensureRelativeFile,
  getWikiGraphStorage,
  resolveHostFile,
  resolveHostReadonlyFile,
  type File,
  type HostDatabaseOpenOptions,
  type ReadonlyFile,
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
  return options.mode === "readonly"
    ? await openSharedStateDatabase(file, schemaSql, options)
    : await openSharedStateDatabase(file, schemaSql, options);
}

/** Open a host File as an idempotently initialized shared SQLite database. */
export async function openSharedStateDatabase(
  fileRef: ReadonlyFile | string,
  schemaSql: string,
  options: { readonly mode: "readonly" },
): Promise<Database>;
export async function openSharedStateDatabase(
  fileRef: File | string,
  schemaSql: string,
  options?: { readonly create: boolean; readonly mode: "readwrite" },
): Promise<Database>;
export async function openSharedStateDatabase(
  fileRef: ReadonlyFile | string,
  schemaSql: string,
  options: HostDatabaseOpenOptions = {
    create: true,
    mode: "readwrite",
  },
): Promise<Database> {
  const file = await resolveHostReadonlyFile(fileRef);
  return options.mode === "readonly"
    ? await Database.open(file, schemaSql, options)
    : await Database.open(file as File, schemaSql, options);
}

/** Initialize a host File without exposing its backing location to Core. */
export async function ensureSharedStateDatabaseInitialized(
  fileRef: File | string,
  schemaSql: string,
): Promise<void> {
  await Database.initialize(await resolveHostFile(fileRef), schemaSql);
}
