import {
  getWikiGraphPlatform,
  resolveHostFile,
  type File,
  type HostZipWriteEntry,
} from "../../../runtime/platform/index.js";
import {
  WIKG_MANIFEST_CONTENT,
  createWikgMutationTokenBytes,
} from "../archive/manifest.js";
import {
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
} from "../archive/constants.js";
import {
  isWikgArchivePath,
  sortArchiveEntryPathsForWrite,
} from "../archive/paths.js";
import { WikgArchiveReader } from "../archive/reader.js";

import {
  DATABASE_ENTRY_PATH,
  LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import {
  acquireArchiveCommitLock,
  acquireEntryLock,
  waitForSqliteLeasesToDrain,
} from "./locks.js";
import {
  deleteCommittedOverlay,
  listOrphanOverlayPaths,
  listOverlays,
  listSettleableOverlays,
  resolveOverlayFile,
} from "./overlays.js";
import { cleanupStaleState, withCoordinatorState } from "./state.js";
import type { CoordinatorOwner, EntryOverlay } from "./types.js";

export async function reapArchive(
  archiveKey: string,
  owner: CoordinatorOwner,
  archive: File,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await cleanupStaleState(database, archiveKey);
  });
  const orphanPaths = await listOrphanOverlayPaths(archiveKey);
  if (orphanPaths.size > 0) {
    await flushArchiveOverlays(archiveKey, owner, orphanPaths, archive);
  }
}

export async function flushArchiveOverlays(
  archiveKey: string,
  owner: CoordinatorOwner,
  requestedEntryPaths?: ReadonlySet<string>,
  archiveInput?: File,
): Promise<Uint8Array | undefined> {
  const candidates = (await listOverlays(archiveKey)).filter(
    (overlay) =>
      requestedEntryPaths === undefined ||
      requestedEntryPaths.has(overlay.entryPath),
  );
  if (candidates.length === 0) return undefined;

  const archive =
    archiveInput ?? (await resolveHostFile(candidates[0]!.archiveIdentity));
  const entryPaths = [
    ...new Set(candidates.map((item) => item.entryPath)),
  ].sort((left, right) => left.localeCompare(right));
  const releases: Array<() => Promise<void>> = [];
  try {
    for (const entryPath of entryPaths) {
      releases.push(
        await acquireEntryLock(archiveKey, entryPath, "write", owner),
      );
    }
    for (const entryPath of entryPaths) {
      if (isSqliteEntry(entryPath)) {
        await waitForSqliteLeasesToDrain(archiveKey, entryPath, owner);
      }
    }

    const requested = new Set(entryPaths);
    const overlays = await listSettleableOverlays(
      archiveKey,
      requested,
      owner.ownerId,
    );
    if (overlays.length === 0) return undefined;

    const releaseCommit = await acquireArchiveCommitLock(archiveKey, owner);
    try {
      return await commitOverlays(archive, overlays);
    } finally {
      await releaseCommit();
    }
  } finally {
    for (const release of releases.reverse()) await release();
  }
}

async function commitOverlays(
  archive: File,
  overlays: readonly EntryOverlay[],
): Promise<Uint8Array> {
  const reader = await WikgArchiveReader.open(archive);
  const overlayByPath = new Map(overlays.map((item) => [item.entryPath, item]));
  if (
    overlayByPath.has(DATABASE_ENTRY_PATH) ||
    overlayByPath.has(SEARCH_INDEX_DATABASE_ENTRY_PATH)
  ) {
    overlayByPath.set(LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH, {
      archiveIdentity: archive.identity,
      archiveKey: overlays[0]!.archiveKey,
      entryPath: LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
      kind: "deleted",
      ownerId: overlays[0]!.ownerId,
      updatedAt: Date.now(),
    });
  }
  const paths = new Set(reader.listEntries());
  for (const overlay of overlayByPath.values()) {
    if (overlay.kind === "deleted") paths.delete(overlay.entryPath);
    else paths.add(overlay.entryPath);
  }
  paths.add(WIKG_MANIFEST_PATH);
  paths.add(WIKG_MUTATION_TOKEN_PATH);
  const mutationToken = createWikgMutationTokenBytes();
  try {
    await getWikiGraphPlatform().zip.write(
      archive,
      createArchiveEntries(reader, overlayByPath, paths, mutationToken),
    );
  } finally {
    await reader.close();
  }

  // The archive is authoritative after its transactional writer commits.
  // Cleanup failure may leave an idempotent overlay for a later reaper, but
  // must not turn a successful physical commit into a rollback attempt.
  for (const overlay of overlays) {
    await deleteCommittedOverlay(overlay).catch(() => undefined);
  }
  return mutationToken;
}

async function* createArchiveEntries(
  reader: WikgArchiveReader,
  overlays: ReadonlyMap<string, EntryOverlay>,
  paths: ReadonlySet<string>,
  mutationToken: Uint8Array,
): AsyncGenerator<HostZipWriteEntry> {
  for (const path of sortArchiveEntryPathsForWrite(paths)) {
    if (!isWikgArchivePath(path)) continue;
    if (path === WIKG_MUTATION_TOKEN_PATH) {
      yield { data: mutationToken, name: path };
      continue;
    }
    if (path === WIKG_MANIFEST_PATH) {
      yield {
        data: new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
        name: path,
      };
      continue;
    }
    const overlay = overlays.get(path);
    if (overlay?.kind === "deleted") continue;
    if (overlay?.kind === "file") {
      yield { file: await resolveOverlayFile(overlay), name: path };
      continue;
    }
    const content = await reader.readEntry(path);
    if (content !== undefined) yield { data: content, name: path };
  }
}

function isSqliteEntry(entryPath: string): boolean {
  return (
    entryPath === DATABASE_ENTRY_PATH ||
    entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH ||
    entryPath === LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH
  );
}
