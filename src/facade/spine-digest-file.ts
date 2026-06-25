import { resolve } from "path";

import { DirectoryDocument } from "../document/index.js";

import { SdpubCoordinator, tryStartSdpubFlusher } from "./sdpub-coordinator.js";
import { SpineDigest } from "./spine-digest.js";

export class SpineDigestFile {
  readonly #path: string;
  readonly #coordinator = new SdpubCoordinator();

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
    } = {},
  ): Promise<T> {
    if (options.documentDirPath === undefined) {
      const document = await DirectoryDocument.open(this.#path, {
        fileStore: this.#coordinator.createFileStore(this.#path, {
          readonlyDatabase: true,
        }),
      });

      try {
        return await operation(document, this.#path);
      } finally {
        await document.release();
      }
    }

    return await this.#coordinator.withReadWorkspace(
      this.#path,
      async (directoryPath) => {
        const document = await DirectoryDocument.open(directoryPath);

        try {
          return await operation(document, directoryPath);
        } finally {
          await document.release();
        }
      },
      options,
    );
  }

  public async write<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
  ): Promise<T> {
    const document = await DirectoryDocument.open(this.#path, {
      fileStore: this.#coordinator.createFileStore(this.#path),
    });
    let completed = false;

    try {
      const result = await operation(document);

      completed = true;
      return result;
    } finally {
      await document.flush();
      await document.release();
      if (completed) {
        await tryStartSdpubFlusher(this.#path);
      }
    }
  }
}
