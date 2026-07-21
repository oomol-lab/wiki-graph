import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve } from "path";

import { createWikiGraphTempDirectory } from "../../../runtime/common/wiki-graph/temp.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import { listWikgArchiveEntries } from "../archive/index.js";

import { createArchiveKey, createOwnerId } from "./archive-key.js";
import { ARCHIVE_SESSION_CONSTRUCTOR_TOKEN, OWNER_HEARTBEAT_INTERVAL_MS } from "./constants.js";
import { WikgDocumentFileStore } from "./file-store.js";
import { flushArchiveOverlays } from "./flusher.js";
import { heartbeatArchiveOwner, reapArchive, registerArchiveOwner, unregisterArchiveOwner } from "./owners.js";
import { listVisibleEntryPaths } from "./overlays.js";
import type { WorkspaceWritebackPolicy } from "./types.js";
import { ensureEmptyDirectory } from "./workspace.js";

export class WikgArchiveSession {
  readonly #archiveKey: string;
  readonly #archivePath: string;
  readonly #ownerId = createOwnerId();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #observedDirtyEntryPaths = new Set<string>();
  readonly #modifiedEntryPaths = new Set<string>();
  #closed = false;

  public constructor(archivePath: string, token?: symbol) {
    if (token !== ARCHIVE_SESSION_CONSTRUCTOR_TOKEN) {
      throw new Error("Use WikgCoordinator.withArchiveSession().");
    }

    this.#archivePath = resolve(archivePath);
    this.#archiveKey = createArchiveKey(this.#archivePath);
    this.#heartbeat = setInterval(() => {
      void heartbeatArchiveOwner({
        archiveKey: this.#archiveKey,
        ownerId: this.#ownerId,
      }).catch(() => undefined);
    }, OWNER_HEARTBEAT_INTERVAL_MS);
  }

  public static async open(archivePath: string): Promise<WikgArchiveSession> {
    const session = new WikgArchiveSession(
      archivePath,
      ARCHIVE_SESSION_CONSTRUCTOR_TOKEN,
    );

    try {
      await registerArchiveOwner({
        archiveKey: session.#archiveKey,
        ownerId: session.#ownerId,
      });
      return session;
    } catch (error) {
      clearInterval(session.#heartbeat);
      throw error;
    }
  }

  public get archiveKey(): string {
    return this.#archiveKey;
  }

  public get archivePath(): string {
    return this.#archivePath;
  }

  public get ownerId(): string {
    return this.#ownerId;
  }

  public observeDirtyEntry(entryPath: string): void {
    this.#observedDirtyEntryPaths.add(entryPath);
  }

  public modifyEntry(entryPath: string): void {
    this.#modifiedEntryPaths.add(entryPath);
  }

  public createFileStore(
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    } = {},
  ): DocumentFileStore {
    return new WikgDocumentFileStore(this.#archivePath, {
      ...options,
      session: this,
    });
  }

  public async materializeReadWorkspace<T>(
    directoryPath: string | undefined,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const ownsDirectoryPath = directoryPath === undefined;
    const resolvedDirectoryPath = ownsDirectoryPath
      ? await createWikiGraphTempDirectory("archive-open")
      : resolve(directoryPath);

    if (!ownsDirectoryPath) {
      await ensureEmptyDirectory(resolvedDirectoryPath);
    }

    const fileStore = this.createFileStore({ readonlyDatabase: true });
    const entries = await listVisibleEntryPaths(
      await listWikgArchiveEntries(this.#archivePath),
      {
        archiveKey: this.#archiveKey,
        prefix: "",
      },
    );

    try {
      for (const entryPath of entries) {
        const content = await fileStore.readFile(entryPath);

        if (content === undefined) {
          continue;
        }

        const targetPath = resolve(resolvedDirectoryPath, entryPath);
        const relativeTargetPath = relative(resolvedDirectoryPath, targetPath);

        if (
          relativeTargetPath.startsWith("..") ||
          isAbsolute(relativeTargetPath)
        ) {
          throw new Error(`Archive entry escapes read workspace: ${entryPath}`);
        }

        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content);
      }

      return await operation(resolvedDirectoryPath);
    } finally {
      await fileStore.close();
      if (ownsDirectoryPath) {
        await rm(resolvedDirectoryPath, { force: true, recursive: true });
      }
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    clearInterval(this.#heartbeat);

    try {
      await this.#settle();
      await reapArchive(this.#archiveKey);
    } finally {
      await unregisterArchiveOwner({
        archiveKey: this.#archiveKey,
        ownerId: this.#ownerId,
      });
    }

    await import("../../../runtime/gc/index.js")
      .then(async ({ tryRunWikiGraphGc }) => {
        await tryRunWikiGraphGc({ opportunistic: true });
      })
      .catch(() => undefined);
  }

  async #settle(): Promise<void> {
    const entryPaths = new Set([
      ...this.#observedDirtyEntryPaths,
      ...this.#modifiedEntryPaths,
    ]);

    if (entryPaths.size === 0) {
      return;
    }

    await flushArchiveOverlays(this.#archiveKey, entryPaths);
  }
}
