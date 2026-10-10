/** Options that may be changed while advancing an existing cursor. */
export interface CursorNextOptions {
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** A runtime page constructor used for page-type identity and reconstruction. */
export type PageClass<P> = abstract new (...args: never[]) => P;

/** The common, deliberately small surface shared by SDK result pages. */
export interface IPage<T> extends Iterable<T> {
  nextCursor(): ICursor<this> | null;
}

/** A lazy continuation associated with a concrete page class. */
export interface ICursor<P extends IPage<unknown>> {
  readonly pageClass: PageClass<P>;
  next(options?: CursorNextOptions): Promise<P>;
  token(): Promise<string>;
  release(): Promise<void>;
}

export interface CursorImplementation<P extends IPage<unknown>> {
  readonly pageClass: PageClass<P>;
  readonly next: (options: CursorNextOptions) => Promise<P>;
  readonly token: () => Promise<string>;
  readonly release?: () => Promise<void> | void;
}

/**
 * Creates a cursor without retaining the page that created it. The callbacks
 * are deliberately supplied by the SDK operation that owns continuation
 * persistence; this type is only the lifecycle/typing facade.
 */
export function createCursor<P extends IPage<unknown>>(
  implementation: CursorImplementation<P>,
): ICursor<P> {
  let released = false;

  const assertLive = (): void => {
    if (released) throw new Error("Cursor has been released.");
  };

  return {
    pageClass: implementation.pageClass,
    async next(options: CursorNextOptions = {}): Promise<P> {
      assertLive();
      return await implementation.next(options);
    },
    async token(): Promise<string> {
      assertLive();
      return await implementation.token();
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      await implementation.release?.();
    },
  };
}

/** Iterates concrete pages and releases each page cursor after advancing. */
export async function* iteratePages<P extends IPage<T>, T>(
  firstPage: P,
  options: CursorNextOptions = {},
): AsyncIterable<P> {
  let page = firstPage;

  while (true) {
    yield page;
    const cursor = page.nextCursor();
    if (cursor === null) return;

    try {
      const nextPage = await cursor.next(options);
      await cursor.release();
      page = nextPage;
    } catch (error) {
      await cursor.release();
      throw error;
    }
  }
}

/** Iterates items across all pages while managing every continuation cursor. */
export async function* iterateItems<P extends IPage<T>, T>(
  firstPage: P,
  options: CursorNextOptions = {},
): AsyncIterable<T> {
  for await (const page of iteratePages(firstPage, options)) {
    yield* page;
  }
}
