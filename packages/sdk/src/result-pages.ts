import type {
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveFindHit,
  ArchiveFindResult,
  ArchiveListItem,
  ArchiveRelatedResult,
  ArchiveSourceLocator,
  ArchiveSourceLocatorResult,
  WikiGraphLibrarySearchBucketPage,
} from "wiki-graph-core";

import {
  createPageCursor,
  type CursorNextOptions,
  type ICursor,
  type IPage,
  type PageClass,
} from "./pages.js";

export class ArchiveFindPage implements IPage<ArchiveFindHit> {
  public readonly result: ArchiveFindResult;
  public readonly chapters: ArchiveFindResult["chapters"];
  public readonly items: ArchiveFindResult["items"];
  public readonly lens: ArchiveFindResult["lens"];
  public readonly lensHint: ArchiveFindResult["lensHint"];
  public readonly limit: number;
  public readonly match: ArchiveFindResult["match"];
  public readonly rawNextCursor: string | null;
  public readonly order: ArchiveFindResult["order"];
  public readonly query: string;
  public readonly terms: readonly string[];
  public readonly types: ArchiveFindResult["types"];
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: ArchiveFindResult,
    cursor: ICursor<ArchiveFindPage> | null = null,
  ) {
    this.result = result;
    this.chapters = result.chapters;
    this.items = result.items;
    this.lens = result.lens;
    this.lensHint = result.lensHint;
    this.limit = result.limit;
    this.match = result.match;
    this.rawNextCursor = result.nextCursor;
    this.order = result.order;
    this.query = result.query;
    this.terms = result.terms;
    this.types = result.types;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<ArchiveFindPage> =
    ArchiveFindPage;
  public [Symbol.iterator](): Iterator<ArchiveFindHit> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export class ArchiveCollectionPage implements IPage<ArchiveFindHit> {
  public readonly result: ArchiveCollectionResult;
  public readonly chapters: ArchiveCollectionResult["chapters"];
  public readonly ids: ArchiveCollectionResult["ids"];
  public readonly items: ArchiveCollectionResult["items"];
  public readonly limit: number;
  public readonly rawNextCursor: string | null;
  public readonly order: ArchiveCollectionResult["order"];
  public readonly types: ArchiveCollectionResult["types"];
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: ArchiveCollectionResult,
    cursor: ICursor<ArchiveCollectionPage> | null = null,
  ) {
    this.result = result;
    this.chapters = result.chapters;
    this.ids = result.ids;
    this.items = result.items;
    this.limit = result.limit;
    this.rawNextCursor = result.nextCursor;
    this.order = result.order;
    this.types = result.types;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<ArchiveCollectionPage> =
    ArchiveCollectionPage;
  public [Symbol.iterator](): Iterator<ArchiveFindHit> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export class ArchiveEvidencePage implements IPage<
  ArchiveEvidence["items"][number]
> {
  public readonly result: ArchiveEvidence;
  public readonly items: ArchiveEvidence["items"];
  public readonly limit: number;
  public readonly rawNextCursor: string | null;
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: ArchiveEvidence,
    cursor: ICursor<ArchiveEvidencePage> | null = null,
  ) {
    this.result = result;
    this.items = result.items;
    this.limit = result.limit;
    this.rawNextCursor = result.nextCursor;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<ArchiveEvidencePage> =
    ArchiveEvidencePage;
  public [Symbol.iterator](): Iterator<ArchiveEvidence["items"][number]> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export class ArchiveRelatedPage implements IPage<ArchiveListItem> {
  public readonly result: ArchiveRelatedResult;
  public readonly items: ArchiveRelatedResult["items"];
  public readonly limit: number;
  public readonly rawNextCursor: string | null;
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: ArchiveRelatedResult,
    cursor: ICursor<ArchiveRelatedPage> | null = null,
  ) {
    this.result = result;
    this.items = result.items;
    this.limit = result.limit;
    this.rawNextCursor = result.nextCursor;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<ArchiveRelatedPage> =
    ArchiveRelatedPage;
  public [Symbol.iterator](): Iterator<ArchiveListItem> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export class ArchiveSourceLocatorPage implements IPage<ArchiveSourceLocator> {
  public readonly result: ArchiveSourceLocatorResult;
  public readonly items: ArchiveSourceLocatorResult["items"];
  public readonly limit: number;
  public readonly rawNextCursor: string | null;
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: ArchiveSourceLocatorResult,
    cursor: ICursor<ArchiveSourceLocatorPage> | null = null,
  ) {
    this.result = result;
    this.items = result.items;
    this.limit = result.limit;
    this.rawNextCursor = result.nextCursor;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<ArchiveSourceLocatorPage> =
    ArchiveSourceLocatorPage;
  public [Symbol.iterator](): Iterator<ArchiveSourceLocator> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export function createArchiveFindPage(
  result: ArchiveFindResult,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<ArchiveFindPage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): ArchiveFindPage {
  return new ArchiveFindPage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: ArchiveFindPage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}

export function createArchiveCollectionPage(
  result: ArchiveCollectionResult,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<ArchiveCollectionPage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): ArchiveCollectionPage {
  return new ArchiveCollectionPage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: ArchiveCollectionPage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}

export function createArchiveEvidencePage(
  result: ArchiveEvidence,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<ArchiveEvidencePage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): ArchiveEvidencePage {
  return new ArchiveEvidencePage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: ArchiveEvidencePage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}

export function createArchiveRelatedPage(
  result: ArchiveRelatedResult,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<ArchiveRelatedPage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): ArchiveRelatedPage {
  return new ArchiveRelatedPage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: ArchiveRelatedPage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}

export function createArchiveSourceLocatorPage(
  result: ArchiveSourceLocatorResult,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<ArchiveSourceLocatorPage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): ArchiveSourceLocatorPage {
  return new ArchiveSourceLocatorPage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: ArchiveSourceLocatorPage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}

export class LibraryBucketPage implements IPage<ArchiveFindHit> {
  public readonly id: string;
  public readonly items: readonly ArchiveFindHit[];
  public readonly rawNextCursor: string | null;
  public readonly query: string;
  public readonly terms: readonly string[];
  public readonly types: WikiGraphLibrarySearchBucketPage["types"];
  readonly #cursor: ICursor<this> | null;

  public constructor(
    result: WikiGraphLibrarySearchBucketPage,
    cursor: ICursor<LibraryBucketPage> | null = null,
  ) {
    this.id = result.id;
    this.items = result.items;
    this.rawNextCursor = result.nextCursor;
    this.query = result.query;
    this.terms = result.terms;
    this.types = result.types;
    this.#cursor = cursor as ICursor<this> | null;
  }

  public static readonly pageClass: PageClass<LibraryBucketPage> =
    LibraryBucketPage;
  public [Symbol.iterator](): Iterator<ArchiveFindHit> {
    return this.items[Symbol.iterator]();
  }
  public nextCursor(): ICursor<this> | null {
    return this.#cursor;
  }
}

export function createLibraryBucketPage(
  result: WikiGraphLibrarySearchBucketPage,
  next: (
    cursor: string,
    options: CursorNextOptions,
  ) => Promise<LibraryBucketPage>,
  createToken: (cursor: string) => Promise<string>,
  releaseToken: (token: string) => Promise<void>,
): LibraryBucketPage {
  return new LibraryBucketPage(
    result,
    result.nextCursor === null
      ? null
      : createPageCursor({
          pageClass: LibraryBucketPage,
          rawCursor: result.nextCursor,
          next,
          createToken,
          releaseToken,
        }),
  );
}
