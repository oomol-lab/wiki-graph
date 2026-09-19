import type { DocumentFileStore } from "../../../document/directory/index.js";
import type { ReadonlyFile } from "../../../runtime/platform/index.js";

import {
  HostWikgArchiveSession,
  withHostArchiveSession,
} from "./host-session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

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
}
