import { readdir } from "fs/promises";
import { join, posix, relative, sep } from "path";

import { Database } from "../../../document/database.js";
import { SEARCH_INDEX_DATABASE_PATH } from "./constants.js";
import { isWikgArchivePath } from "./paths.js";

export async function listDocumentFiles(
  rootDirectoryPath: string,
  currentDirectoryPath = rootDirectoryPath,
): Promise<Array<{ absolutePath: string; archivePath: string }>> {
  const entries = await readdir(currentDirectoryPath, { withFileTypes: true });
  const files: Array<{ absolutePath: string; archivePath: string }> = [];

  for (const entry of [...entries].sort(compareDirEntryName)) {
    const absolutePath = join(currentDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listDocumentFiles(rootDirectoryPath, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    files.push({
      absolutePath,
      archivePath: relative(rootDirectoryPath, absolutePath)
        .split(sep)
        .join(posix.sep),
    });
  }

  return files.filter((file) => isWikgArchivePath(file.archivePath));
}

export async function shouldEmbedSearchIndex(
  documentDirectoryPath: string,
): Promise<boolean> {
  const database = await Database.open(
    join(documentDirectoryPath, "database.db"),
    "",
    {
      readonly: true,
    },
  ).catch(() => undefined);

  if (database === undefined) {
    return false;
  }

  try {
    const row = await database.queryOne(
      `
        SELECT fts_embedded
        FROM archive_index_settings
        WHERE id = 1
      `,
      undefined,
      (value) => Number(value.fts_embedded) !== 0,
    );

    return row ?? false;
  } catch {
    return false;
  } finally {
    await database.close();
  }
}

export function shouldWriteDocumentFile(input: {
  readonly archivePath: string;
  readonly includeSearchIndex: boolean;
}): boolean {
  if (input.archivePath === "manifest.json") {
    return false;
  }
  if (input.archivePath === ".wikg-mutation-token") {
    return false;
  }

  return (
    input.archivePath !== SEARCH_INDEX_DATABASE_PATH || input.includeSearchIndex
  );
}

function compareDirEntryName(
  left: { readonly name: string },
  right: { readonly name: string },
): number {
  return left.name.localeCompare(right.name);
}
