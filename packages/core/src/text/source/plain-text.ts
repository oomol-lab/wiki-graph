import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename, extname, resolve } from "path";

import { BOOK_META_VERSION, type BookMeta } from "./meta.js";
import type { SourceAdapter, SourceDocument } from "./adapter.js";
import type { SourceAsset, SourceSection, SourceTextStream } from "./types.js";

type PlainTextSourceFormat = "markdown" | "txt";

const ROOT_SECTION_ID = "root";

class PlainTextSection implements SourceSection {
  readonly #path: string;
  readonly #id: string;

  public constructor(path: string, id = ROOT_SECTION_ID) {
    this.#path = resolve(path);
    this.#id = id;
  }

  public get id(): string {
    return this.#id;
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
    return Promise.resolve(createReadStream(this.#path, { encoding: "utf8" }));
  }
}

class PlainTextDocument implements SourceDocument {
  readonly #path: string;
  readonly #format: PlainTextSourceFormat;
  readonly #section: PlainTextSection;

  public constructor(path: string, format: PlainTextSourceFormat) {
    this.#path = resolve(path);
    this.#format = format;
    this.#section = new PlainTextSection(this.#path);
  }

  public readMeta(): Promise<BookMeta> {
    return Promise.resolve({
      version: BOOK_META_VERSION,
      sourceFormat: this.#format,
      title: getFileStem(this.#path),
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
  readonly #format: PlainTextSourceFormat;

  public constructor(format: PlainTextSourceFormat) {
    this.#format = format;
  }

  public get format(): PlainTextSourceFormat {
    return this.#format;
  }

  public async openSession<T>(
    path: string,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T> {
    const resolvedPath = resolve(path);
    const fileStat = await stat(resolvedPath);

    if (!fileStat.isFile()) {
      throw new Error(`Source file is not a regular file: ${resolvedPath}`);
    }

    return await operation(new PlainTextDocument(resolvedPath, this.#format));
  }
}

export const TXT_SOURCE_ADAPTER = new PlainTextSourceAdapter("txt");
export const MARKDOWN_SOURCE_ADAPTER = new PlainTextSourceAdapter("markdown");

function getFileStem(path: string): string | null {
  const stem = basename(path, extname(path)).trim();

  return stem === "" ? null : stem;
}
