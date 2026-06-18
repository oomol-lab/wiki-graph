import { resolve } from "path";

import { DirectoryDocument } from "../document/index.js";

import { SdpubCoordinator } from "./sdpub-coordinator.js";
import { SpineDigest } from "./spine-digest.js";

export class SpineDigestFile {
  readonly #path: string;
  readonly #coordinator = new SdpubCoordinator();

  public constructor(path: string) {
    this.#path = resolve(path);
  }

  public async openSession<T>(
    operation: (digest: SpineDigest) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    return await this.#coordinator.openSession(
      this.#path,
      async (directoryPath) => {
        const document = await DirectoryDocument.open(directoryPath);

        try {
          return await operation(new SpineDigest(document, directoryPath));
        } finally {
          await document.release();
        }
      },
      options,
    );
  }

  public async openEditableSession<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
  ): Promise<T> {
    return await this.#coordinator.openEditableSession(
      this.#path,
      async (directoryPath) => {
        const document = await DirectoryDocument.open(directoryPath);

        try {
          return await operation(document);
        } finally {
          await document.flush();
          await document.release();
        }
      },
    );
  }
}
