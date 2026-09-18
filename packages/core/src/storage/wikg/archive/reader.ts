import {
  getRelativeFile,
  getWikiGraphPlatform,
  readFileText,
  resolveHostDirectory,
  resolveHostFile,
  type Directory,
  type File,
  type HostZipReader,
} from "../../../runtime/platform/index.js";
import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import {
  WIKG_SCHEMA_VERSION,
  parseWikgManifest,
  parseWikgMutationToken,
} from "./manifest.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";

export class WikgArchiveReader {
  readonly #entries: ReadonlyMap<string, string>;
  readonly #reader: HostZipReader;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(
    reader: HostZipReader,
    entries: ReadonlyMap<string, string>,
  ) {
    this.#reader = reader;
    this.#entries = entries;
  }

  public static async open(fileRef: File | string): Promise<WikgArchiveReader> {
    const file = await resolveHostFile(fileRef);
    const reader = await getWikiGraphPlatform().zip.open(file);
    try {
      const entries = new Map<string, string>();
      for (const hostName of await reader.listEntries()) {
        const name = normalizeArchivePath(hostName);
        if (name !== "" && isWikgArchivePath(name)) entries.set(name, hostName);
      }
      await assertCurrentArchive(reader, entries);
      return new WikgArchiveReader(reader, entries);
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    await this.#reader.close();
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public async readEntry(entryPath: string): Promise<Uint8Array | undefined> {
    const hostName = this.#entries.get(normalizeArchivePath(entryPath));
    return hostName === undefined
      ? undefined
      : await this.#reader.readEntry(hostName);
  }

  public async copyEntry(entryPath: string, target: File): Promise<boolean> {
    const hostName = this.#entries.get(normalizeArchivePath(entryPath));
    if (hostName === undefined) return false;
    return await this.#reader.copyEntry(hostName, target);
  }
}

export async function listWikgArchiveEntries(
  file: File | string,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(file);
  try {
    return reader.listEntries();
  } finally {
    await reader.close();
  }
}

export async function readWikgArchiveEntry(
  file: File | string,
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
  file: File | string,
): Promise<string> {
  const reader = await getWikiGraphPlatform().zip.open(
    await resolveHostFile(file),
  );
  try {
    const hostName = (await reader.listEntries()).find(
      (name) => normalizeArchivePath(name) === WIKG_MUTATION_TOKEN_PATH,
    );
    const content =
      hostName === undefined ? undefined : await reader.readEntry(hostName);
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
  entries: ReadonlyMap<string, string>,
): Promise<void> {
  const hostName = entries.get(WIKG_MANIFEST_PATH);
  const manifest =
    hostName === undefined ? undefined : await reader.readEntry(hostName);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  const parsed = parseWikgManifest(new TextDecoder().decode(manifest));
  if (parsed.schemaVersion !== WIKG_SCHEMA_VERSION) {
    throw new Error(
      `WIKG schema version ${parsed.schemaVersion} requires migration.`,
    );
  }
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
