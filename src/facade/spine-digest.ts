import type { ReadonlyDocument } from "../document/index.js";
import { writeEpub, writePlainText } from "../output/index.js";
import type {
  BookMeta,
  SourceAsset,
  TocFile,
  TocItem,
} from "../source/index.js";

import { readSdpubArchiveFormatVersion, writeSdpubArchive } from "./archive.js";
import type { SpineDigestSerialEntry } from "./types.js";

export class SpineDigest {
  readonly #document: ReadonlyDocument;
  readonly #documentDirectoryPath: string;

  public constructor(
    document: ReadonlyDocument,
    documentDirectoryPath: string,
  ) {
    this.#document = document;
    this.#documentDirectoryPath = documentDirectoryPath;
  }

  public async exportEpub(path: string): Promise<void> {
    await writeEpub({
      document: this.#document,
      path,
    });
  }

  public async exportText(path: string): Promise<void> {
    await writePlainText({
      document: this.#document,
      path,
    });
  }

  public async readCover(): Promise<SourceAsset | undefined> {
    return await this.#document.readCover();
  }

  public async readMeta(): Promise<BookMeta | undefined> {
    return await this.#document.readBookMeta();
  }

  public async readToc(): Promise<TocFile | undefined> {
    return await this.#document.readToc();
  }

  public async readArchiveFormatVersion(): Promise<number> {
    return await readSdpubArchiveFormatVersion(this.#documentDirectoryPath);
  }

  public async listSerials(): Promise<readonly SpineDigestSerialEntry[]> {
    return await this.#document.openSession(async (document) => {
      const toc = await document.readToc();

      if (toc === undefined) {
        throw new Error("Document TOC is missing");
      }

      return await collectSerialEntries(document, toc.items);
    });
  }

  public async readSerialSummary(serialId: number): Promise<string> {
    return await this.#document.openSession(async (document) => {
      const record = await document.serials.getById(serialId);

      if (record === undefined) {
        throw new Error(
          `No completed summary exists for id ${serialId}. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids, then \`spinedigest read <archive.sdpub> summary:${serialId}\` after summary is ready.`,
        );
      }

      const summary = await document.readSummary(serialId);

      if (summary === undefined) {
        throw new Error(
          `Chapter ${serialId} summary is missing. Run \`spinedigest build <archive.sdpub> --stage summary --confirm\` before export, or inspect the chapter with \`spinedigest page <archive.sdpub> chapter:${serialId}\`.`,
        );
      }

      return summary;
    });
  }

  public async saveAs(path: string): Promise<void> {
    await flushDocument(this.#document);
    await writeSdpubArchive(this.#documentDirectoryPath, path);
  }
}

async function flushDocument(document: ReadonlyDocument): Promise<void> {
  if (!isFlushableDocument(document)) {
    return;
  }

  await document.flush();
}

function isFlushableDocument(
  document: ReadonlyDocument,
): document is ReadonlyDocument & { flush(): Promise<void> } {
  return "flush" in document && typeof document.flush === "function";
}

async function collectSerialEntries(
  document: ReadonlyDocument,
  items: readonly TocItem[],
  ancestorTitles: readonly string[] = [],
): Promise<readonly SpineDigestSerialEntry[]> {
  const entries: SpineDigestSerialEntry[] = [];

  for (const item of items) {
    const title = item.title?.trim() || `Chapter ${item.serialId ?? "group"}`;
    const tocPath = [...ancestorTitles, title];

    if (item.serialId !== undefined) {
      const summary = await document.readSummary(item.serialId);

      if (summary !== undefined) {
        entries.push({
          fragmentCount: (
            await document.getSerialFragments(item.serialId).listFragmentIds()
          ).length,
          serialId: item.serialId,
          title,
          tocPath,
        });
      }
    }

    entries.push(
      ...(await collectSerialEntries(document, item.children, tocPath)),
    );
  }

  return entries;
}
