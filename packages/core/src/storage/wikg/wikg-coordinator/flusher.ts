import { mkdir, mkdtemp, rename, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";

import { writeWikgArchiveWithOverlays } from "../archive/index.js";

import { createArchiveKey } from "./archive-key.js";
import {
  DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import {
  acquireArchiveCommitLock,
  acquireEntryLock,
  waitForSqliteLeasesToDrain,
} from "./locks.js";
import {
  deleteOverlay,
  listOverlays,
  resolveArchivePathFromKey,
  toArchiveOverlay,
} from "./overlays.js";
import { cleanupStaleState, getString, withStateDatabase } from "./state.js";

export async function tryStartWikgFlusher(archivePath?: string): Promise<void> {
  if (archivePath !== undefined) {
    await flushArchiveOverlays(createArchiveKey(resolve(archivePath)));
    return;
  }

  const archiveKeys = await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    return await state.queryAll(
      `
SELECT DISTINCT archive_key
FROM entry_overlays
ORDER BY archive_key
`,
      undefined,
      (row) => getString(row, "archive_key"),
    );
  });

  for (const archiveKey of archiveKeys) {
    await flushArchiveOverlays(archiveKey);
  }
}

export async function flushArchiveOverlays(
  archiveKey: string,
  requestedEntryPaths?: ReadonlySet<string>,
): Promise<void> {
  const overlays = (await listOverlays(archiveKey)).filter(
    (overlay) =>
      requestedEntryPaths === undefined ||
      requestedEntryPaths.has(overlay.entryPath),
  );
  const archivePath = await resolveArchivePathFromKey(archiveKey);

  if (overlays.length === 0 || archivePath === undefined) {
    return;
  }

  const entryPaths = overlays
    .map((overlay) => overlay.entryPath)
    .sort((left, right) => left.localeCompare(right));
  const lockedEntryPaths = new Set(entryPaths);
  const releaseLocks: Array<() => Promise<void>> = [];

  try {
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "write"));
    }
    for (const entryPath of entryPaths) {
      releaseLocks.push(await acquireEntryLock(archiveKey, entryPath, "state"));
    }

    if (entryPaths.includes(DATABASE_ENTRY_PATH)) {
      await waitForSqliteLeasesToDrain(archiveKey, DATABASE_ENTRY_PATH);
    }
    if (entryPaths.includes(SEARCH_INDEX_DATABASE_ENTRY_PATH)) {
      await waitForSqliteLeasesToDrain(
        archiveKey,
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
      );
    }

    const currentOverlays = (await listOverlays(archiveKey)).filter((overlay) =>
      lockedEntryPaths.has(overlay.entryPath),
    );

    if (currentOverlays.length === 0) {
      return;
    }

    const releaseCommit = await acquireArchiveCommitLock(archiveKey);

    try {
      const temporaryDirectoryPath = await mkdtemp(
        join(tmpdir(), "wikigraph-flush-"),
      );
      const temporaryArchivePath = join(
        temporaryDirectoryPath,
        basename(archivePath),
      );

      try {
        await writeWikgArchiveWithOverlays(
          archivePath,
          temporaryArchivePath,
          currentOverlays.map(toArchiveOverlay),
        );
        await mkdir(dirname(archivePath), { recursive: true });
        await rename(temporaryArchivePath, archivePath);
      } finally {
        await rm(temporaryDirectoryPath, { force: true, recursive: true });
      }
    } finally {
      await releaseCommit();
    }

    for (const overlay of currentOverlays) {
      await deleteOverlay(archiveKey, overlay.entryPath);
      if (overlay.workspacePath !== undefined) {
        await rm(overlay.workspacePath, { force: true });
      }
    }
  } finally {
    for (const release of releaseLocks.reverse()) {
      await release();
    }
  }
}
