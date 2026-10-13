import {
  copyFileContent,
  ensureRelativeFile,
  getRelativeDirectory,
  getRelativeFile,
  readFileBytes,
  readFileText,
  type Directory,
  type File,
  type HostZipReader,
} from "../../../runtime/platform/index.js";
import { normalizeArchivePath, isReadableWikgArchivePath } from "./paths.js";

/** Physical directory access; coordination and overlays remain session-owned. */
export async function openDirectoryArchive(
  directory: Directory,
): Promise<HostZipReader> {
  const find = async (name: string) => {
    const path = normalizeArchivePath(name);
    return isReadableWikgArchivePath(path)
      ? await getRelativeFile(directory, path)
      : undefined;
  };
  return {
    close: async () => {},
    listEntries: async () => [
      ...(await listDirectoryArchiveFiles(directory)).keys(),
    ],
    readEntry: async (name) => {
      const file = await find(name);
      return file === undefined ? undefined : await readFileBytes(file);
    },
    copyEntry: async (name, target) => {
      const file = await find(name);
      if (file === undefined) return false;
      await copyFileContent(file, target);
      return true;
    },
    getEntrySize: async (name) => {
      const file = await find(name);
      if (file === undefined) return undefined;
      const reader = await file.openReader();
      try {
        return reader.size;
      } finally {
        await reader.close();
      }
    },
    readEntryRange: async (name, offset, length) => {
      const file = await find(name);
      if (file === undefined) return undefined;
      const reader = await file.openReader();
      try {
        return await reader.read(offset, length);
      } finally {
        await reader.close();
      }
    },
  };
}

export async function listDirectoryArchiveFiles(
  directory: Directory,
): Promise<ReadonlyMap<string, File>> {
  const entries = new Map<string, File>();
  async function walk(root: Directory, prefix: string): Promise<void> {
    for (const entry of await root.list()) {
      const path = prefix === "" ? entry.name : `${prefix}${entry.name}`;
      if (entry.kind === "directory") {
        if (!entry.name.startsWith(".")) await walk(entry, `${path}/`);
      } else if (isReadableWikgArchivePath(path)) {
        entries.set(path, entry);
      }
    }
  }
  await walk(directory, "");
  return entries;
}

const JOURNAL = ".wikg-transaction";

export interface DirectoryArchiveChange {
  readonly path: string;
  readonly file?: File;
  readonly data?: Uint8Array;
}

/** A durable undo journal makes partial multi-file publication recoverable. */
export async function commitDirectoryArchive(
  root: Directory,
  changes: readonly DirectoryArchiveChange[],
): Promise<void> {
  await recoverDirectoryArchive(root);
  const journal = await root.createDirectory(JOURNAL);
  const before: Array<{ path: string; existed: boolean }> = [];
  try {
    for (const change of changes) {
      assertPath(change.path);
      const source = await getRelativeFile(root, change.path);
      before.push({ path: change.path, existed: source !== undefined });
      if (source !== undefined) {
        await copyFileContent(
          source,
          await ensureRelativeFile(journal, "before/" + change.path),
        );
      }
    }
    // No live data is modified until the complete undo journal is durable.
    await writeBytes(
      await journal.createFile("pending.json"),
      JSON.stringify(before),
    );
    for (const change of changes) {
      if (change.file !== undefined) {
        await copyFileContent(
          change.file,
          await ensureRelativeFile(root, change.path),
        );
      } else if (change.data !== undefined) {
        await writeBytes(
          await ensureRelativeFile(root, change.path),
          change.data,
        );
      } else {
        await removeEntry(root, change.path);
      }
    }
    // Once committed, recovery only cleans the journal; it never rolls back.
    await writeBytes(await journal.createFile("committed"), "1");
  } catch (error) {
    await recoverDirectoryArchive(root);
    throw error;
  }
  await root.remove(JOURNAL, { recursive: true }).catch(() => undefined);
}

export async function recoverDirectoryArchive(root: Directory): Promise<void> {
  const journal = await root.getDirectory(JOURNAL);
  if (journal === undefined) return;
  const pending = await journal.getFile("pending.json");
  if (
    pending !== undefined &&
    (await journal.getFile("committed")) === undefined
  ) {
    const parsed: unknown = JSON.parse(await readFileText(pending));
    if (!Array.isArray(parsed))
      throw new Error("Invalid directory archive journal");
    for (const item of parsed as unknown[]) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("path" in item) ||
        typeof item.path !== "string" ||
        !("existed" in item) ||
        typeof item.existed !== "boolean"
      ) {
        throw new Error("Invalid directory archive journal entry");
      }
      assertPath(item.path);
      if (item.existed) {
        const file = await getRelativeFile(journal, "before/" + item.path);
        if (file === undefined)
          throw new Error("Missing directory archive rollback file");
        await copyFileContent(file, await ensureRelativeFile(root, item.path));
      } else {
        await removeEntry(root, item.path);
      }
    }
  }
  await root.remove(JOURNAL, { recursive: true });
}

function assertPath(path: string): void {
  if (normalizeArchivePath(path) !== path || !isReadableWikgArchivePath(path)) {
    throw new Error(`Invalid directory archive path: ${path}`);
  }
}

async function removeEntry(root: Directory, path: string): Promise<void> {
  const parts = path.split("/");
  const name = parts.pop()!;
  const parent =
    parts.length === 0
      ? root
      : await getRelativeDirectory(root, parts.join("/"));
  if (parent !== undefined && (await parent.getFile(name)) !== undefined)
    await parent.remove(name);
}

async function writeBytes(
  file: File,
  data: string | Uint8Array,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    await writer.write(data);
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
