import type { ReadonlyDocument } from "../../../document/index.js";

import { writeEpubArchive } from "./archive.js";
import { buildEpubBook } from "./book.js";
import { EPUB_OUTPUT_VERSION } from "./package.js";

export interface WriteEpubOptions {
  readonly document: ReadonlyDocument;
  readonly path: string;
}

export async function writeEpub(options: WriteEpubOptions): Promise<void> {
  const book = await options.document.openSession(async (document) => {
    return await buildEpubBook(document);
  });

  await writeEpubArchive(options.path, book);
}

export { EPUB_OUTPUT_VERSION };
