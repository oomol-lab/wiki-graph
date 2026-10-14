import {
  getRelativeFile,
  getWikiGraphPlatform,
  readFileText,
  resolveHostDirectory,
  resolveHostReadonlyFile,
  type Directory,
  type File,
  type ReadonlyFile,
  type HostZipReader,
} from "../../../runtime/platform/index.js";
import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import {
  WIKG_SCHEMA_VERSION,
  parseWikgManifest,
  parseWikgMutationToken,
} from "./manifest.js";
import { isReadableWikgArchivePath, normalizeArchivePath } from "./paths.js";
import { openDirectoryArchive } from "./directory-backend.js";
import { WikiGraphSchemaVersionError } from "../../../runtime/common/error.js";

export class WikgArchiveReader {
  readonly #reader: HostZipReader;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(reader: HostZipReader) {
    this.#reader = reader;
  }

  public static async open(
    fileRef: ReadonlyFile | Directory | string,
  ): Promise<WikgArchiveReader> {
    const reader =
      typeof fileRef !== "string" && fileRef.kind === "directory"
        ? await openDirectoryArchive(fileRef)
        : await getWikiGraphPlatform().zip.open(
            await resolveHostReadonlyFile(fileRef),
            { entryNameMode: "normalized" },
          );
    try {
      await assertCurrentArchive(
        reader,
        typeof fileRef === "string" ? fileRef : fileRef.identity,
      );
      return new WikgArchiveReader(reader);
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    await this.#reader.close();
  }

  public async listEntries(): Promise<readonly string[]> {
    return [
      ...new Set(
        (await this.#reader.listEntries())
          .map(normalizeArchivePath)
          .filter(isReadableWikgArchivePath),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  public async readEntry(entryPath: string): Promise<Uint8Array | undefined> {
    const hostName = readablePath(entryPath);
    return hostName === undefined
      ? undefined
      : await this.#reader.readEntry(hostName);
  }

  public async copyEntry(entryPath: string, target: File): Promise<boolean> {
    const hostName = readablePath(entryPath);
    if (hostName === undefined) return false;
    return await this.#reader.copyEntry(hostName, target);
  }

  public async getEntrySize(entryPath: string): Promise<number | undefined> {
    const hostName = readablePath(entryPath);
    return hostName === undefined
      ? undefined
      : await this.#reader.getEntrySize(hostName);
  }

  public async readEntryRange(
    entryPath: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    const hostName = readablePath(entryPath);
    return hostName === undefined
      ? undefined
      : await this.#reader.readEntryRange(hostName, offset, length);
  }
}

export async function listWikgArchiveEntries(
  file: ReadonlyFile | string,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(file);
  try {
    return await reader.listEntries();
  } finally {
    await reader.close();
  }
}

export async function readWikgArchiveEntry(
  file: ReadonlyFile | Directory | string,
  entryPath: string,
): Promise<Uint8Array | undefined> {
  const reader = await WikgArchiveReader.open(file);
  try {
    return await reader.readEntry(entryPath);
  } finally {
    await reader.close();
  }
}

export async function readWikgArchiveMutationToken(
  file: ReadonlyFile | Directory | string,
): Promise<string> {
  if (typeof file !== "string" && file.kind === "directory") {
    const token = await file.getFile(WIKG_MUTATION_TOKEN_PATH);
    if (token === undefined)
      throw new Error(
        `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
      );
    return parseWikgMutationToken(await readFileText(token));
  }
  const reader = await getWikiGraphPlatform().zip.open(
    await resolveHostReadonlyFile(file),
    { entryNameMode: "normalized" },
  );
  try {
    const content = await reader.readEntry(WIKG_MUTATION_TOKEN_PATH);
    if (content === undefined) {
      throw new Error(
        `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
      );
    }
    return parseWikgMutationToken(new TextDecoder().decode(content));
  } finally {
    await reader.close();
  }
}

async function assertCurrentArchive(
  reader: HostZipReader,
  identity: string,
): Promise<void> {
  const manifest = await reader.readEntry(WIKG_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  const parsed = parseWikgManifest(new TextDecoder().decode(manifest));
  if (parsed.schemaVersion !== WIKG_SCHEMA_VERSION) {
    throw new WikiGraphSchemaVersionError(
      { kind: "archive", path: identity },
      parsed.schemaVersion,
      WIKG_SCHEMA_VERSION,
    );
  }
}

function readablePath(path: string): string | undefined {
  const normalized = normalizeArchivePath(path);
  return isReadableWikgArchivePath(normalized) ? normalized : undefined;
}

export async function readWikgArchiveFormatVersion(
  documentDirectoryRef: Directory | string,
): Promise<number> {
  return (
    await readDocumentManifest(await resolveHostDirectory(documentDirectoryRef))
  ).formatVersion;
}

export async function readWikgArchiveSchemaVersion(
  documentDirectoryRef: Directory | string,
): Promise<number> {
  return (
    await readDocumentManifest(await resolveHostDirectory(documentDirectoryRef))
  ).schemaVersion;
}

async function readDocumentManifest(directory: Directory) {
  const file = await getRelativeFile(directory, WIKG_MANIFEST_PATH);
  if (file === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  return parseWikgManifest(await readFileText(file));
}
