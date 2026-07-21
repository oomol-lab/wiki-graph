import {
  readWikgArchiveMutationToken,
  type WikgArchiveOverlay,
} from "../archive/index.js";

import { createArchiveSignature } from "./archive-key.js";
import { SEARCH_INDEX_DATABASE_ENTRY_PATH } from "./constants.js";
import { getString, mapEntryOverlay, withStateDatabase } from "./state.js";
import type { EntryOverlay } from "./types.js";

export async function listVisibleEntryPaths(
  archiveEntries: readonly string[],
  input: { readonly archiveKey: string; readonly prefix: string },
): Promise<readonly string[]> {
  const matchingArchiveEntries = archiveEntries.filter((entryPath) =>
    entryPath.startsWith(input.prefix),
  );
  const overlays = await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
`,
        [input.archiveKey],
        mapEntryOverlay,
      ),
  );
  const entries = new Set(matchingArchiveEntries);

  for (const overlay of overlays) {
    if (!overlay.entryPath.startsWith(input.prefix)) {
      continue;
    }
    if (overlay.kind === "deleted") {
      entries.delete(overlay.entryPath);
    } else {
      entries.add(overlay.entryPath);
    }
  }

  return [...entries].sort((left, right) => left.localeCompare(right));
}

export async function resolveEntrySource(input: {
  readonly archiveKey: string;
  readonly entryPath: string;
}): Promise<
  | { readonly kind: "archive" }
  | { readonly kind: "deleted" }
  | { readonly kind: "workspace"; readonly path: string }
> {
  const overlay = await readOverlay(input.archiveKey, input.entryPath);

  if (overlay?.kind === "deleted") {
    return { kind: "deleted" };
  }
  if (overlay?.workspacePath !== undefined) {
    return { kind: "workspace", path: overlay.workspacePath };
  }
  return { kind: "archive" };
}

export async function readOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<EntryOverlay | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT * FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
        [archiveKey, entryPath],
        mapEntryOverlay,
      ),
  );
}

export async function listOverlays(
  archiveKey: string,
): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(
    async (state) =>
      await state.queryAll(
        `
SELECT *
FROM entry_overlays
WHERE archive_key = ?
ORDER BY entry_path ASC
`,
        [archiveKey],
        mapEntryOverlay,
      ),
  );
}

export async function upsertOverlay(input: {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly workspacePath?: string;
}): Promise<void> {
  const mutationToken =
    input.entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH
      ? await readWikgArchiveMutationToken(input.archivePath)
      : undefined;

  await withStateDatabase(async (state) => {
    await state.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path,
  archive_signature, mutation_token, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(archive_key, entry_path)
DO UPDATE SET kind = excluded.kind,
              archive_path = excluded.archive_path,
              workspace_path = excluded.workspace_path,
              archive_signature = excluded.archive_signature,
              mutation_token = excluded.mutation_token,
              updated_at = excluded.updated_at
`,
      [
        input.archiveKey,
        input.archivePath,
        input.entryPath,
        input.kind,
        input.workspacePath ?? null,
        await createArchiveSignature(input.archivePath),
        mutationToken ?? null,
        Date.now(),
      ],
    );
  });
}

export async function deleteOverlay(
  archiveKey: string,
  entryPath: string,
): Promise<void> {
  await withStateDatabase(async (state) => {
    await state.run(
      "DELETE FROM entry_overlays WHERE archive_key = ? AND entry_path = ?",
      [archiveKey, entryPath],
    );
  });
}

export async function resolveArchivePathFromKey(
  archiveKey: string,
): Promise<string | undefined> {
  return await withStateDatabase(
    async (state) =>
      await state.queryOne(
        "SELECT archive_path FROM entry_overlays WHERE archive_key = ? LIMIT 1",
        [archiveKey],
        (row) => getString(row, "archive_path"),
      ),
  );
}

export function toArchiveOverlay(overlay: EntryOverlay): WikgArchiveOverlay {
  if (overlay.kind === "deleted") {
    return {
      entryPath: overlay.entryPath,
      kind: "deleted",
    };
  }
  if (overlay.workspacePath === undefined) {
    throw new Error(`Missing workspace path for ${overlay.entryPath}.`);
  }

  return {
    entryPath: overlay.entryPath,
    kind: "file",
    workspacePath: overlay.workspacePath,
  };
}
