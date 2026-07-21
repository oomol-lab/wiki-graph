import { readdir, rm } from "fs/promises";
import { basename, dirname, join } from "path";

import {
  isDisposableDirectoryEntry,
  readPathSize,
  removeDisposableChildDirectories,
  removeDisposableDescendantDirectories,
  removeDisposableDirectory,
} from "../../../runtime/gc/files.js";
import type { GcContext, GcJobResult } from "../../../runtime/gc/index.js";
import { isNodeError } from "../../../utils/node-error.js";

import {
  hasActiveArchiveOwnerOrSqliteLease,
  hasActiveWorkspaceUse,
} from "./activity.js";
import { pathExists } from "./archive-key.js";
import {
  DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
  SQLITE_CACHE_TTL_MS,
} from "./constants.js";
import { acquireEntryLock } from "./locks.js";
import { deleteOverlay, listOverlays, readOverlay } from "./overlays.js";
import { readSearchIndexCacheStatus } from "./search-index-cache.js";
import {
  cleanupStaleState,
  mapEntryOverlay,
  withStateDatabase,
} from "./state.js";
import type { EntryOverlay, WorkspaceDirectoryEntry } from "./types.js";
import {
  getCoordinatorWorkspaceRootPath,
  listWorkspaceFiles,
} from "./workspace.js";

export async function runWikgCoordinatorGc(
  context: GcContext,
): Promise<GcJobResult> {
  const candidates = await listSqliteCacheGcCandidates();
  let removed = 0;
  let freedBytes = 0;

  for (const candidate of candidates) {
    const result = await tryRemoveSqliteCacheCandidate(candidate, context);

    if (result.removed) {
      removed += 1;
      freedBytes += result.freedBytes;
    }
  }

  const orphanedFiles = await removeOrphanedWorkspaceFiles(context);
  const childDirectories = context.dryRun
    ? { freedBytes: 0, removed: 0, scanned: 0 }
    : await removeDisposableChildDirectories(getCoordinatorWorkspaceRootPath());

  return {
    freedBytes:
      freedBytes + orphanedFiles.freedBytes + childDirectories.freedBytes,
    removed: removed + orphanedFiles.removed + childDirectories.removed,
    scanned:
      candidates.length + orphanedFiles.scanned + childDirectories.scanned,
  };
}

async function listSqliteCacheGcCandidates(): Promise<readonly EntryOverlay[]> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT overlay.*
FROM entry_overlays AS overlay
WHERE overlay.entry_path IN (?, ?)
  AND overlay.kind = 'file'
  AND overlay.workspace_path IS NOT NULL
ORDER BY overlay.updated_at ASC
`,
      [DATABASE_ENTRY_PATH, SEARCH_INDEX_DATABASE_ENTRY_PATH],
      mapEntryOverlay,
    );
  });
}

async function tryRemoveSqliteCacheCandidate(
  candidate: EntryOverlay,
  context: GcContext,
): Promise<{ readonly freedBytes: number; readonly removed: boolean }> {
  const releaseWriteLock = await acquireEntryLock(
    candidate.archiveKey,
    candidate.entryPath,
    "write",
  );

  try {
    const releaseStateLock = await acquireEntryLock(
      candidate.archiveKey,
      candidate.entryPath,
      "state",
    );

    try {
      const overlay = await readOverlay(
        candidate.archiveKey,
        candidate.entryPath,
      );

      if (
        overlay?.workspacePath === undefined ||
        overlay.workspacePath !== candidate.workspacePath ||
        !(await canRemoveSqliteCacheOverlay(overlay, context))
      ) {
        return { freedBytes: 0, removed: false };
      }

      let freedBytes = await readPathSize(overlay.workspacePath);

      if (!context.dryRun) {
        await deleteOverlay(overlay.archiveKey, overlay.entryPath);
        await rm(overlay.workspacePath, { force: true });
        freedBytes += await removeDisposableDirectory(
          dirname(overlay.workspacePath),
        );
      }

      return { freedBytes, removed: true };
    } finally {
      await releaseStateLock();
    }
  } finally {
    await releaseWriteLock();
  }
}

async function canRemoveSqliteCacheOverlay(
  overlay: EntryOverlay,
  context: GcContext,
): Promise<boolean> {
  if (
    await hasActiveArchiveOwnerOrSqliteLease(
      overlay.archiveKey,
      overlay.entryPath,
    )
  ) {
    return false;
  }
  if (overlay.workspacePath === undefined) {
    return false;
  }

  if (await isSqliteCacheOverlayDirty(overlay)) {
    return true;
  }
  if (!context.force && context.now - overlay.updatedAt < SQLITE_CACHE_TTL_MS) {
    return false;
  }
  if (
    overlay.entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH &&
    !context.force
  ) {
    return false;
  }

  return true;
}

async function isSqliteCacheOverlayDirty(
  overlay: EntryOverlay,
): Promise<boolean> {
  if (overlay.workspacePath === undefined) {
    return true;
  }
  if (!(await pathExists(overlay.workspacePath))) {
    return true;
  }
  if (!(await pathExists(overlay.archivePath))) {
    return true;
  }
  if (overlay.entryPath !== SEARCH_INDEX_DATABASE_ENTRY_PATH) {
    return false;
  }

  return (await readSearchIndexCacheStatus(overlay)) !== "current";
}

async function removeOrphanedWorkspaceFiles(
  context: GcContext,
): Promise<Pick<GcJobResult, "freedBytes" | "removed" | "scanned">> {
  const rootPath = getCoordinatorWorkspaceRootPath();
  let archiveKeyEntries: readonly WorkspaceDirectoryEntry[];

  try {
    archiveKeyEntries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { freedBytes: 0, removed: 0, scanned: 0 };
    }

    throw error;
  }

  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;

  for (const archiveKeyEntry of archiveKeyEntries) {
    if (!archiveKeyEntry.isDirectory()) {
      continue;
    }

    const archiveKey = archiveKeyEntry.name;

    if (await hasActiveWorkspaceUse(archiveKey)) {
      continue;
    }

    const referencedWorkspacePaths = new Set(
      (await listOverlays(archiveKey))
        .map((overlay) => overlay.workspacePath)
        .filter((path): path is string => path !== undefined),
    );

    for (const workspacePath of await listWorkspaceFiles(
      join(rootPath, archiveKey),
    )) {
      scanned += 1;

      if (isDisposableDirectoryEntry(basename(workspacePath))) {
        continue;
      }
      if (referencedWorkspacePaths.has(workspacePath)) {
        continue;
      }

      const size = await readPathSize(workspacePath);

      if (!context.dryRun) {
        await rm(workspacePath, { force: true });
      }

      freedBytes += size;
      removed += 1;
    }

    if (!context.dryRun) {
      const disposableDirectories = await removeDisposableDescendantDirectories(
        join(rootPath, archiveKey),
      );

      freedBytes += disposableDirectories.freedBytes;
      removed += disposableDirectories.removed;
      scanned += disposableDirectories.scanned;
    }
  }

  return { freedBytes, removed, scanned };
}
