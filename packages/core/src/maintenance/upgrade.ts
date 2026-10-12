import {
  listWikiGraphLibraryArchives,
  resolveWikiGraphLibrary,
  withWikiGraphLibraryLock,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryRecord,
} from "../library/index.js";
import type { Directory, File } from "../runtime/platform/index.js";
import {
  CURRENT_ARCHIVE_SCHEMA_VERSION,
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
  readWikiGraphHomeSchemaVersion,
  upgradeWikiGraphArchiveSchema,
} from "../storage/schema-upgrade/index.js";

export type WikiGraphMaintenanceTarget =
  | { readonly kind: "home" }
  | { readonly file: File; readonly kind: "archive" }
  | { readonly kind: "library"; readonly target: ParsedWikiGraphLibraryUri };

export type WikiGraphMaintenanceUpgradeResult =
  | {
      readonly kind: "home";
      readonly schemaVersionBefore: number;
      readonly schemaVersionAfter: number;
      readonly status: "already-current" | "upgraded";
    }
  | {
      readonly fileIdentity: string;
      readonly fileName: string;
      readonly kind: "archive";
      readonly schemaVersionBefore: number;
      readonly schemaVersionAfter: number;
      readonly status: "already-current" | "upgraded";
    }
  | WikiGraphLibraryUpgradeResult;

export interface WikiGraphLibraryUpgradeResult {
  readonly kind: "lib";
  readonly library: {
    readonly id: number;
    readonly publicId: string;
    readonly uri: string;
    readonly folderIdentity: string;
    readonly stagingIdentity: string;
  };
  readonly upgraded: readonly WikiGraphLibraryArchiveUpgradeItem[];
  readonly skipped: readonly WikiGraphLibraryArchiveUpgradeItem[];
  readonly failed?: WikiGraphLibraryArchiveFailure | undefined;
  readonly status: "already-current" | "partial" | "upgraded";
}

export interface WikiGraphLibraryArchiveUpgradeItem {
  readonly fileIdentity: string;
  readonly relativePath: string;
  readonly publicId: string;
  readonly uri: string;
  readonly schemaVersionBefore: number;
  readonly schemaVersionAfter: number;
}

export interface WikiGraphLibraryArchiveFailure {
  readonly fileIdentity: string;
  readonly relativePath: string;
  readonly publicId: string;
  readonly uri: string;
  readonly message: string;
}

export async function upgradeWikiGraphMaintenanceTarget(
  target: WikiGraphMaintenanceTarget,
): Promise<WikiGraphMaintenanceUpgradeResult> {
  if (target.kind === "home") {
    const schemaVersionBefore = await readWikiGraphHomeSchemaVersion();
    await ensureWikiGraphHomeSchemaCurrent();
    const schemaVersionAfter = await readWikiGraphHomeSchemaVersion();
    return {
      kind: "home",
      schemaVersionBefore,
      schemaVersionAfter,
      status:
        schemaVersionBefore === schemaVersionAfter
          ? "already-current"
          : "upgraded",
    };
  }
  if (target.kind === "library") {
    return await upgradeWikiGraphLibrarySchema(target.target);
  }
  const schemaVersionBefore = await readWikiGraphArchiveSchemaVersion(
    target.file,
  );
  const upgradeResult = await upgradeWikiGraphArchiveSchema(target.file);
  const schemaVersionAfter = await readWikiGraphArchiveSchemaVersion(
    target.file,
  );
  return {
    fileIdentity: target.file.identity,
    fileName: target.file.name,
    kind: "archive",
    schemaVersionBefore,
    schemaVersionAfter,
    status: upgradeResult.changed ? "upgraded" : "already-current",
  };
}

export async function assertWikiGraphLibrarySchemaCurrent(
  target: ParsedWikiGraphLibraryUri,
): Promise<void> {
  const library = await resolveWikiGraphLibrary(target);
  const archives = await listWikiGraphLibraryArchives({
    isDefault: library.isDefault,
    kind: "scope",
    ...(library.isDefault ? {} : { publicId: library.publicId }),
  });
  for (const archive of archives) {
    if (!isUpgradeableLibraryArchive(archive)) continue;
    const schemaVersion = await readWikiGraphArchiveSchemaVersion(
      requireArchiveStorage(archive),
    );
    if (schemaVersion !== CURRENT_ARCHIVE_SCHEMA_VERSION) {
      throw new Error(
        schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION
          ? `This Wiki Graph library contains an unsupported future archive schema v${schemaVersion}: ${library.uri}.`
          : `This Wiki Graph library must be upgraded before use: ${library.uri}.`,
      );
    }
  }
}

export async function upgradeWikiGraphLibrarySchema(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryUpgradeResult> {
  await ensureWikiGraphHomeSchemaCurrent();
  const library = await resolveWikiGraphLibrary(target);
  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await clearLibraryDerivedData(library);
    const archives = (
      await listWikiGraphLibraryArchives({
        isDefault: library.isDefault,
        kind: "scope",
        ...(library.isDefault ? {} : { publicId: library.publicId }),
      })
    ).filter(isUpgradeableLibraryArchive);
    const upgraded: WikiGraphLibraryArchiveUpgradeItem[] = [];
    const skipped: WikiGraphLibraryArchiveUpgradeItem[] = [];

    for (const archive of archives) {
      const storage = requireArchiveStorage(archive);
      const schemaVersionBefore =
        await readWikiGraphArchiveSchemaVersion(storage);
      try {
        const result = await upgradeWikiGraphArchiveSchema(storage);
        const item = {
          fileIdentity: storage.identity,
          publicId: archive.publicId,
          relativePath: archive.relativePath,
          schemaVersionAfter: await readWikiGraphArchiveSchemaVersion(storage),
          schemaVersionBefore,
          uri: archive.uri,
        };
        (result.changed ? upgraded : skipped).push(item);
      } catch (error) {
        return {
          failed: {
            fileIdentity: storage.identity,
            message: formatErrorMessage(error),
            publicId: archive.publicId,
            relativePath: archive.relativePath,
            uri: archive.uri,
          },
          kind: "lib",
          library: formatLibraryResult(library),
          skipped,
          status: "partial",
          upgraded,
        };
      }
    }

    return {
      kind: "lib",
      library: formatLibraryResult(library),
      skipped,
      status: upgraded.length === 0 ? "already-current" : "upgraded",
      upgraded,
    };
  });
}

function isUpgradeableLibraryArchive(
  archive: WikiGraphLibraryArchiveRecord,
): boolean {
  return (
    archive.exists &&
    archive.status === "present" &&
    (archive.directory !== undefined || archive.file !== undefined)
  );
}

function requireArchiveStorage(
  archive: WikiGraphLibraryArchiveRecord,
): Directory | File {
  const storage = archive.directory ?? archive.file;
  if (storage === undefined) {
    throw new Error(`Library archive is unavailable: ${archive.uri}`);
  }
  return storage;
}

async function clearLibraryDerivedData(
  library: WikiGraphLibraryRecord,
): Promise<void> {
  for (const entry of await library.staging.list()) {
    await library.staging.remove(entry.name, { recursive: true });
  }
}

function formatLibraryResult(library: WikiGraphLibraryRecord) {
  return {
    folderIdentity: library.folder.identity,
    id: library.id,
    publicId: library.publicId,
    stagingIdentity: library.staging.identity,
    uri: library.uri,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
