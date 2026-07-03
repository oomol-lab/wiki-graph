import { resolve } from "path";

import { DirectoryDocument } from "../document/index.js";

import { WikgCoordinator } from "./wikg-coordinator.js";
import { deleteArchiveSearchSessions } from "../archive/query/index.js";
import { SpineDigest } from "../facade/spine-digest.js";

export class SpineDigestFile {
  readonly #path: string;
  readonly #coordinator = new WikgCoordinator();

  public constructor(path: string) {
    this.#path = resolve(path);
  }

  public async read<T>(
    operation: (digest: SpineDigest) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    return await this.readDocument(
      async (document, directoryPath) =>
        await operation(new SpineDigest(document, directoryPath)),
      options,
    );
  }

  public async readDocument<T>(
    operation: (
      document: DirectoryDocument,
      directoryPath: string,
    ) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
      readonly searchIndexWritebackPolicy?: "archive" | "cache";
    } = {},
  ): Promise<T> {
    return await this.#coordinator.withArchiveSession(
      this.#path,
      async (session) => {
        if (options.documentDirPath !== undefined) {
          return await session.materializeReadWorkspace(
            options.documentDirPath,
            async (directoryPath) => {
              const document = await DirectoryDocument.open(directoryPath);

              try {
                return await operation(document, directoryPath);
              } finally {
                await document.release();
              }
            },
          );
        }

        const document = await DirectoryDocument.open(this.#path, {
          fileStore: session.createFileStore({
            readonlyDatabase: true,
            ...(options.searchIndexWritebackPolicy === undefined
              ? {}
              : {
                  searchIndexWritebackPolicy:
                    options.searchIndexWritebackPolicy,
                }),
          }),
        });

        try {
          return await operation(document, this.#path);
        } finally {
          await document.release();
        }
      },
    );
  }

  public async write<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: { readonly searchIndexWritebackPolicy?: "archive" | "cache" } = {},
  ): Promise<T> {
    return await this.#coordinator.withArchiveSession(
      this.#path,
      async (session) => {
        const document = await DirectoryDocument.open(this.#path, {
          fileStore: session.createFileStore({
            ...(options.searchIndexWritebackPolicy === undefined
              ? {}
              : {
                  searchIndexWritebackPolicy:
                    options.searchIndexWritebackPolicy,
                }),
          }),
        });

        try {
          return await operation(document);
        } finally {
          try {
            await document.release();
          } finally {
            await deleteArchiveSearchSessions(this.#path);
          }
        }
      },
    );
  }
}
