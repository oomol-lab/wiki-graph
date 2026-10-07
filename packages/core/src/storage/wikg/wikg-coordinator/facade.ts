import type { DocumentFileStore } from "../../../document/directory/index.js";
import type { File, ReadonlyFile } from "../../../runtime/platform/index.js";
import { createPortableHash } from "../../../utils/crypto.js";

import {
  HostWikgArchiveSession,
  withHostArchiveSession,
} from "./host-session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";
import { reapArchive } from "./flusher.js";
import {
  createCoordinatorOwner,
  heartbeatArchiveOwner,
  registerArchiveReplacementOwner,
  unregisterArchiveOwner,
  waitForOtherArchiveOwnersToDrain,
} from "./owners.js";
import { OWNER_HEARTBEAT_INTERVAL_MS } from "./constants.js";

/** Coordinates archive access without observing the host File implementation. */
export class WikgCoordinator {
  public createFileStore(
    _archive: ReadonlyFile,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: HostWikgArchiveSession;
    } = {},
  ): DocumentFileStore {
    if (!(options.session instanceof HostWikgArchiveSession)) {
      throw new Error("Archive files require an active host session.");
    }
    return options.session.createFileStore(options);
  }

  public async withArchiveSession<T>(
    archive: ReadonlyFile,
    operation: (session: HostWikgArchiveSession) => Promise<T> | T,
  ): Promise<T> {
    return await withHostArchiveSession(archive, operation);
  }

  /** Stops new sessions, drains current sessions, then runs one physical replacement. */
  public async withExclusiveArchiveReplacement<T>(
    archive: File,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const archiveKey = createPortableHash("sha256")
      .update(archive.identity)
      .digest("hex");
    const owner = createCoordinatorOwner();
    await registerArchiveReplacementOwner(archiveKey, owner);
    const heartbeat = globalThis.setInterval(() => {
      void heartbeatArchiveOwner(archiveKey, owner).catch(() => undefined);
    }, OWNER_HEARTBEAT_INTERVAL_MS);
    try {
      await waitForOtherArchiveOwnersToDrain(archiveKey, owner.ownerId);
      await reapArchive(archiveKey, owner, archive);
      return await operation();
    } finally {
      globalThis.clearInterval(heartbeat);
      await unregisterArchiveOwner(archiveKey, owner.ownerId);
    }
  }
}
