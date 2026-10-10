import { describe, expect, it, vi } from "vitest";

import {
  createCursor,
  iterateItems,
  iteratePages,
  type CursorNextOptions,
  type ICursor,
  type IPage,
} from "./pages.js";

class TestPage implements IPage<number> {
  public readonly values: readonly number[];
  readonly #cursor: ICursor<TestPage> | null;

  public constructor(
    values: readonly number[],
    cursor: ICursor<TestPage> | null = null,
  ) {
    this.values = values;
    this.#cursor = cursor;
  }

  public [Symbol.iterator](): Iterator<number> {
    return this.values[Symbol.iterator]();
  }

  public nextCursor(): ICursor<this> | null {
    return this.#cursor as ICursor<this> | null;
  }
}

function cursorFor(
  next: (options: CursorNextOptions) => Promise<TestPage>,
  release = vi.fn(),
): ICursor<TestPage> {
  return createCursor({
    pageClass: TestPage,
    next,
    token: () => Promise.resolve("c_test"),
    release,
  });
}

describe("SDK page and cursor facade", () => {
  it("keeps the page class without retaining the originating page", async () => {
    const release = vi.fn();
    const cursor = cursorFor(
      () => Promise.resolve(new TestPage([2])),
      release,
    );

    expect(cursor.pageClass).toBe(TestPage);
    expect(await cursor.token()).toBe("c_test");
    await cursor.release();
    await cursor.release();
    expect(release).toHaveBeenCalledTimes(1);
    await expect(cursor.token()).rejects.toThrow("released");
    await expect(cursor.next()).rejects.toThrow("released");
  });

  it("releases cursors while iterating pages and items", async () => {
    const releases = [vi.fn(), vi.fn()];
    const third = new TestPage([3]);
    const second = new TestPage(
      [2],
      cursorFor(() => Promise.resolve(third), releases[1]),
    );
    const first = new TestPage(
      [1],
      cursorFor(() => Promise.resolve(second), releases[0]),
    );
    const pages: TestPage[] = [];
    for await (const page of iteratePages(first)) pages.push(page);
    expect(pages).toEqual([first, second, third]);
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).toHaveBeenCalledOnce();

    const thirdForItems = new TestPage([3]);
    const secondForItems = new TestPage(
      [2],
      cursorFor(() => Promise.resolve(thirdForItems)),
    );
    const firstForItems = new TestPage(
      [1],
      cursorFor(() => Promise.resolve(secondForItems)),
    );
    const items = [];
    for await (const item of iterateItems(firstForItems)) items.push(item);
    expect(items).toEqual([1, 2, 3]);
  });

  it("releases a cursor when advancing fails", async () => {
    const release = vi.fn();
    const page = new TestPage(
      [1],
      cursorFor(
        () => Promise.reject(new Error("boom")),
        release,
      ),
    );

    await expect(async () => {
      for await (const _item of iterateItems(page)) {
        // Consume until the failing continuation is reached.
      }
    }).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledOnce();
  });
});
