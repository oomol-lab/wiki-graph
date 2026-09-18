import {
  getWikiGraphPlatform,
  resolveHostDirectory,
  resolveHostFile,
  type Directory,
  type File,
  type HostZipReader,
  type HostZipWriteEntry,
} from "../../../runtime/platform/index.js";
import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
} from "./constants.js";
import { shouldWriteDocumentFile } from "./document-files.js";
import {
  createWikgMutationTokenContent,
  WIKG_MANIFEST_CONTENT,
} from "./manifest.js";
import {
  isWikgArchivePath,
  normalizeArchivePath,
  sortArchiveEntryPathsForWrite,
} from "./paths.js";
import type { WikgArchiveOverlay } from "./types.js";

export async function writeWikgArchive(
  documentDirectoryRef: Directory | string,
  outputFileRef: File | string,
): Promise<void> {
  await writeWikgArchiveFromDirectory(documentDirectoryRef, outputFileRef);
}

export async function writeWikgArchiveFromDirectory(
  documentDirectoryRef: Directory | string,
  outputFileRef: File | string,
): Promise<void> {
  const documentDirectory = await resolveHostDirectory(documentDirectoryRef);
  const outputFile = await resolveHostFile(outputFileRef);
  const entries = new Map<string, HostZipWriteEntry>();
  entries.set(WIKG_MUTATION_TOKEN_PATH, {
    data: createWikgMutationTokenContent(),
    name: WIKG_MUTATION_TOKEN_PATH,
  });
  entries.set(WIKG_MANIFEST_PATH, {
    data: new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
    name: WIKG_MANIFEST_PATH,
  });
  for (const entry of await listHostDocumentFiles(documentDirectory)) {
    if (
      isWikgArchivePath(entry.name) &&
      shouldWriteDocumentFile({ archivePath: entry.name })
    ) {
      entries.set(entry.name, entry);
    }
  }
  await getWikiGraphPlatform().zip.write(
    outputFile,
    sortArchiveEntryPathsForWrite(entries.keys()).map(
      (name) => entries.get(name) as HostZipWriteEntry,
    ),
  );
}

export async function writeWikgArchiveWithOverlays(
  inputFileRef: File | string,
  outputFileRef: File | string,
  overlays: readonly WikgArchiveOverlay[],
  options: { readonly preserveMutationToken?: boolean } = {},
): Promise<void> {
  const inputFile = await resolveHostFile(inputFileRef);
  const outputFile = await resolveHostFile(outputFileRef);
  const reader = await getWikiGraphPlatform().zip.open(inputFile);
  try {
    const archiveEntries = new Map<string, string>();
    for (const hostName of await reader.listEntries()) {
      const name = normalizeArchivePath(hostName);
      if (name !== "" && isWikgArchivePath(name)) {
        archiveEntries.set(name, hostName);
      }
    }
    const entries = new Map<
      string,
      | { readonly kind: "archive"; readonly hostName: string }
      | WikgArchiveOverlay
    >(
      [...archiveEntries].map(([name, hostName]) => [
        name,
        { hostName, kind: "archive" },
      ]),
    );
    for (const overlay of overlays) {
      const name = normalizeArchivePath(overlay.entryPath);
      if (!isWikgArchivePath(name)) continue;
      if (overlay.kind === "deleted") entries.delete(name);
      else entries.set(name, overlay);
    }
    entries.delete(LEGACY_SEARCH_INDEX_DATABASE_PATH);
    const mutationToken =
      options.preserveMutationToken === true
        ? await readArchiveEntry(
            reader,
            archiveEntries,
            WIKG_MUTATION_TOKEN_PATH,
          )
        : undefined;
    entries.delete(WIKG_MUTATION_TOKEN_PATH);
    entries.delete(WIKG_MANIFEST_PATH);
    const paths = new Set(entries.keys());
    paths.add(WIKG_MUTATION_TOKEN_PATH);
    paths.add(WIKG_MANIFEST_PATH);

    await getWikiGraphPlatform().zip.write(
      outputFile,
      (async function* (): AsyncGenerator<HostZipWriteEntry> {
        for (const name of sortArchiveEntryPathsForWrite(paths)) {
          if (name === WIKG_MUTATION_TOKEN_PATH) {
            yield {
              data: mutationToken ?? createWikgMutationTokenContent(),
              name,
            };
            continue;
          }
          if (name === WIKG_MANIFEST_PATH) {
            yield {
              data: new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
              name,
            };
            continue;
          }
          const source = entries.get(name);
          if (source === undefined || source.kind === "deleted") continue;
          if (source.kind === "archive") {
            const size = await reader.getEntrySize(source.hostName);
            if (size !== undefined) {
              yield {
                name,
                size,
                read: async (offset, length) => {
                  const content = await reader.readEntryRange(
                    source.hostName,
                    offset,
                    length,
                  );
                  if (content === undefined) {
                    throw new Error(`Archive entry disappeared: ${name}.`);
                  }
                  return content;
                },
              };
            }
            continue;
          }
          yield { file: source.file, name };
        }
      })(),
    );
  } finally {
    await reader.close();
  }
}

async function readArchiveEntry(
  reader: HostZipReader,
  entries: ReadonlyMap<string, string>,
  name: string,
): Promise<Uint8Array | undefined> {
  const hostName = entries.get(name);
  return hostName === undefined ? undefined : await reader.readEntry(hostName);
}

async function listHostDocumentFiles(
  directory: Directory,
  prefix = "",
): Promise<HostZipWriteEntry[]> {
  const output: HostZipWriteEntry[] = [];
  const children = [...(await directory.list())].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const child of children) {
    const name = prefix === "" ? child.name : `${prefix}/${child.name}`;
    if ("read" in child) {
      output.push({ file: child, name });
    } else {
      output.push(...(await listHostDocumentFiles(child, name)));
    }
  }
  return output;
}
