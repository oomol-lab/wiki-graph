import type { ReadonlyDocument } from "../document/index.js";
import { writeEpub, writePlainText } from "../output/index.js";
import type {
  BookMeta,
  SourceAsset,
  TocFile,
  TocItem,
} from "../source/index.js";

import {
  readWikgArchiveFormatVersion,
  writeWikgArchive,
} from "../wikg/index.js";
import type { ChapterStage } from "./chapter.js";
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
    return await readWikgArchiveFormatVersion(this.#documentDirectoryPath);
  }

  public async readChapterStage(serialId: number): Promise<ChapterStage> {
    return await this.#document.openSession(async (document) => {
      const toc = await document.readToc();

      if (toc === undefined) {
        throw new Error("Document TOC is missing");
      }
      if (!toc.items.some((item) => hasSerialId(item, serialId))) {
        throw new Error(
          `Chapter ${serialId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
        );
      }

      const summary = await document.readSummary(serialId);

      if (summary !== undefined) {
        return "summarized";
      }

      const serial = await document.serials.getById(serialId);

      if (serial?.topologyReady === true) {
        return "graphed";
      }
      if (
        (await document.getSerialFragments(serialId).listFragmentIds()).length >
        0
      ) {
        return "sourced";
      }

      return "planned";
    });
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
          `No completed summary exists for id ${serialId}. Use \`wg wikg://<archive.wikg>/chapter list\` to discover chapter ids, then \`wg wikg://<archive.wikg>/chapter/${serialId}/summary get\` after summary is ready.`,
        );
      }

      const summary = await document.readSummary(serialId);

      if (summary === undefined) {
        throw new Error(
          `Chapter ${serialId} summary is missing. Run \`wg wikg://local/job add --input <chapter-uri> --task reading-summary --accept-cost\` before export, or inspect the archive with \`wg <archive-uri>/chapter/tree get\`.`,
        );
      }

      return summary;
    });
  }

  public async saveAs(path: string): Promise<void> {
    await flushDocument(this.#document);
    await writeWikgArchive(this.#documentDirectoryPath, path);
  }
}

function hasSerialId(item: TocItem, serialId: number): boolean {
  return (
    item.serialId === serialId ||
    item.children.some((child) => hasSerialId(child, serialId))
  );
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
