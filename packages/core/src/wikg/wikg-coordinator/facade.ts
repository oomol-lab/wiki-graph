import { rm } from "fs/promises";
import { resolve } from "path";

import { createWikiGraphTempDirectory } from "../../common/wiki-graph/temp.js";
import type { DocumentFileStore } from "../../document/directory.js";

import { extractWikgArchive } from "../archive.js";

import { WikgDocumentFileStore } from "./file-store.js";
import { WikgArchiveSession } from "./session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

export class WikgCoordinator {
  public createFileStore(
    archivePath: string,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: WikgArchiveSession;
    } = {},
  ): DocumentFileStore {
    return new WikgDocumentFileStore(resolve(archivePath), options);
  }

  public async withArchiveSession<T>(
    archivePath: string,
    operation: (session: WikgArchiveSession) => Promise<T> | T,
  ): Promise<T> {
    const session = await WikgArchiveSession.open(resolve(archivePath));

    try {
      return await operation(session);
    } finally {
      await session.close();
    }
  }

  public async withReadWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    const directoryPath =
      options.documentDirPath === undefined
        ? await createWikiGraphTempDirectory("archive-open")
        : resolve(options.documentDirPath);

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      if (options.documentDirPath === undefined) {
        await rm(directoryPath, { force: true, recursive: true });
      }
    }
  }

  public async withWriteWorkspace<T>(
    archivePath: string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const directoryPath = await createWikiGraphTempDirectory("archive-write");

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}
