import type { File } from "../../runtime/platform/index.js";

import { BOOK_META_VERSION, type BookMeta } from "./meta.js";
import type { SourceAdapter, SourceDocument } from "./adapter.js";
import type { SourceAsset, SourceSection, SourceTextStream } from "./types.js";

type PlainTextSourceFormat = "markdown" | "txt";
const ROOT_SECTION_ID = "root";

class PlainTextSection implements SourceSection {
  readonly #file: File;
  readonly #sectionId: string;

  public constructor(file: File, sectionId = ROOT_SECTION_ID) {
    this.#file = file;
    this.#sectionId = sectionId;
  }

  public get id(): string {
    return this.#sectionId;
  }
  public get hasContent(): boolean {
    return true;
  }
  public get title(): string | undefined {
    return undefined;
  }
  public get children(): readonly SourceSection[] {
    return [];
  }
  public open(): Promise<SourceTextStream> {
    return Promise.resolve(iterateFileLines(this.#file));
  }
}

class PlainTextDocument implements SourceDocument {
  readonly #section: PlainTextSection;
  readonly #file: File;
  readonly #sourceFormat: PlainTextSourceFormat;

  public constructor(file: File, sourceFormat: PlainTextSourceFormat) {
    this.#file = file;
    this.#sourceFormat = sourceFormat;
    this.#section = new PlainTextSection(file);
  }

  public readMeta(): Promise<BookMeta> {
    return Promise.resolve({
      version: BOOK_META_VERSION,
      sourceFormat: this.#sourceFormat,
      title: getFileStem(this.#file.name),
      authors: [],
      language: null,
      identifier: null,
      publisher: null,
      publishedAt: null,
      description: null,
    });
  }
  public readCover(): Promise<SourceAsset | undefined> {
    return Promise.resolve(undefined);
  }
  public readSections(): Promise<readonly SourceSection[]> {
    return Promise.resolve([this.#section]);
  }
}

export class PlainTextSourceAdapter implements SourceAdapter {
  readonly #sourceFormat: PlainTextSourceFormat;

  public constructor(sourceFormat: PlainTextSourceFormat) {
    this.#sourceFormat = sourceFormat;
  }

  public get format(): PlainTextSourceFormat {
    return this.#sourceFormat;
  }

  public async openSession<T>(
    file: File,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T> {
    const reader = await file.openReader();
    await reader.close();
    return await operation(new PlainTextDocument(file, this.#sourceFormat));
  }
}

export const TXT_SOURCE_ADAPTER = new PlainTextSourceAdapter("txt");
export const MARKDOWN_SOURCE_ADAPTER = new PlainTextSourceAdapter("markdown");

async function* iterateFileLines(file: File): AsyncIterable<string> {
  const reader = await file.openReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (let offset = 0; offset < reader.size; ) {
      const chunk = await reader.read(
        offset,
        Math.min(64 * 1024, reader.size - offset),
      );
      offset += chunk.byteLength;
      pending += decoder.decode(chunk, { stream: offset < reader.size });
      const lines = pending.split(/(?<=\n)/u);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line !== "") yield line;
    }
    pending += decoder.decode();
    if (pending !== "") yield pending;
  } finally {
    await reader.close();
  }
}

function getFileStem(name: string): string | null {
  const separator = name.lastIndexOf(".");
  const stem = (separator <= 0 ? name : name.slice(0, separator)).trim();
  return stem === "" ? null : stem;
}
