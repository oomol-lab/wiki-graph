import { mkdir, rename, rm } from "fs/promises";
import { dirname } from "path";

import { Database as DocumentDatabase } from "../../../document/index.js";
import { ensureWikiGraphHomeSchemaCurrent } from "../../../document/home-schema-upgrade.js";
import { readSearchIndexFingerprintFromDatabase } from "../../../retrieval/search-index/index.js";

import { readWikgArchiveMutationToken } from "../archive/index.js";

import { createArchiveSignature, pathExists } from "./archive-key.js";
import {
  hasActiveArchiveOwnerOrSqliteLease,
  hasActiveWorkspaceUse,
} from "./activity.js";
import { SEARCH_INDEX_DATABASE_ENTRY_PATH } from "./constants.js";
import { acquireEntryLock } from "./locks.js";
import { readOverlay } from "./overlays.js";
import {
  cleanupStaleState,
  mapEntryOverlay,
  withStateDatabase,
} from "./state.js";
import type { EntryOverlay } from "./types.js";
import { createWorkspaceFilePath } from "./workspace.js";

export async function readSearchIndexCacheStatus(
  overlay: EntryOverlay,
): Promise<"current" | "dirty" | "missing"> {
  if (overlay.workspacePath === undefined) {
    return "missing";
  }
  if (!(await pathExists(overlay.workspacePath))) {
    return "missing";
  }
  if (!(await pathExists(overlay.archivePath))) {
    return "dirty";
  }

  try {
    const indexedFingerprint = await readSearchIndexCacheFingerprint(
      overlay.workspacePath,
    );
    const currentSignature = await createArchiveSignature(overlay.archivePath);

    if (indexedFingerprint === undefined) {
      return "dirty";
    }

    return overlay.archiveSignature === currentSignature ? "current" : "dirty";
  } catch {
    return "dirty";
  }
}

async function readSearchIndexCacheFingerprint(
  databasePath: string,
): Promise<string | undefined> {
  await ensureWikiGraphHomeSchemaCurrent();
  const database = await DocumentDatabase.open(databasePath, "", {
    readonly: true,
  });

  try {
    return await readSearchIndexFingerprintFromDatabase(database);
  } finally {
    await database.close();
  }
}

export async function tryAdoptSearchIndexCacheOverlay(input: {
  readonly targetArchiveKey: string;
  readonly targetArchivePath: string;
}): Promise<void> {
  const mutationToken = await readWikgArchiveMutationToken(
    input.targetArchivePath,
  );
  const candidates = await listSearchIndexAdoptionCandidates({
    mutationToken,
    targetArchiveKey: input.targetArchiveKey,
  });
  const adoptable: EntryOverlay[] = [];

  for (const candidate of candidates) {
    if (
      candidate.workspacePath === undefined ||
      (await pathExists(candidate.archivePath)) ||
      (await hasActiveWorkspaceUse(candidate.archiveKey))
    ) {
      continue;
    }

    adoptable.push(candidate);
  }

  if (adoptable.length !== 1) {
    return;
  }

  const candidate = adoptable[0]!;
  const releaseWriteLock = await acquireEntryLock(
    candidate.archiveKey,
    SEARCH_INDEX_DATABASE_ENTRY_PATH,
    "write",
  );

  try {
    const releaseStateLock = await acquireEntryLock(
      candidate.archiveKey,
      SEARCH_INDEX_DATABASE_ENTRY_PATH,
      "state",
    );

    try {
      const current = await readOverlay(
        candidate.archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );
      const target = await readOverlay(
        input.targetArchiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );

      if (
        current?.workspacePath === undefined ||
        current.workspacePath !== candidate.workspacePath ||
        current.mutationToken !== mutationToken ||
        target !== undefined ||
        (await pathExists(candidate.archivePath)) ||
        (await hasActiveArchiveOwnerOrSqliteLease(
          candidate.archiveKey,
          SEARCH_INDEX_DATABASE_ENTRY_PATH,
        ))
      ) {
        return;
      }

      const targetWorkspacePath = await createWorkspaceFilePath(
        input.targetArchiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );

      await rm(targetWorkspacePath, { force: true }).catch(() => undefined);
      await mkdir(dirname(targetWorkspacePath), { recursive: true });
      await rename(current.workspacePath, targetWorkspacePath);
      await withStateDatabase(async (state) => {
        await state.run(
          `
UPDATE entry_overlays
SET archive_key = ?,
    archive_path = ?,
    workspace_path = ?,
    archive_signature = ?,
    updated_at = ?
WHERE archive_key = ?
  AND entry_path = ?
`,
          [
            input.targetArchiveKey,
            input.targetArchivePath,
            targetWorkspacePath,
            await createArchiveSignature(input.targetArchivePath),
            Date.now(),
            candidate.archiveKey,
            SEARCH_INDEX_DATABASE_ENTRY_PATH,
          ],
        );
      });
    } finally {
      await releaseStateLock();
    }
  } finally {
    await releaseWriteLock();
  }
}

async function listSearchIndexAdoptionCandidates(input: {
  readonly mutationToken: string;
  readonly targetArchiveKey: string;
}): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT *
FROM entry_overlays
WHERE entry_path = ?
  AND kind = 'file'
  AND workspace_path IS NOT NULL
  AND mutation_token = ?
  AND archive_key <> ?
ORDER BY updated_at ASC
`,
      [
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
        input.mutationToken,
        input.targetArchiveKey,
      ],
      mapEntryOverlay,
    );
  });
}
