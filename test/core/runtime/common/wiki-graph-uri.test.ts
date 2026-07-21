import { describe, expect, it } from "vitest";
import { homedir } from "os";
import { resolve } from "path";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphCommandUri,
  formatWikiGraphObjectUri,
  parseLocatedWikiGraphUri,
} from "../../../../packages/core/src/runtime/common/wiki-graph/uri.js";

describe("wiki graph URI helpers", () => {
  it("formats located URIs with URL path separators", () => {
    expect(
      formatLocatedWikiGraphUri(
        String.raw`C:\books\book.wikg`,
        formatWikiGraphObjectUri("entity/Q9957"),
      ),
    ).toBe("wikg://C:/books/book.wikg/entity/Q9957");
  });

  it("formats command URIs relative to cwd when the archive is below cwd", () => {
    expect(
      formatWikiGraphCommandUri(
        "/workspace/books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg://books/book.wikg/entity/Q9957");
  });

  it("formats command URIs with absolute paths outside cwd", () => {
    expect(
      formatWikiGraphCommandUri(
        "/other/books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg:///other/books/book.wikg/entity/Q9957");
  });

  it("formats relative command URI archive paths against the provided cwd", () => {
    expect(
      formatWikiGraphCommandUri(
        "books/book.wikg",
        formatWikiGraphObjectUri("entity/Q9957"),
        "/workspace",
      ),
    ).toBe("wikg://books/book.wikg/entity/Q9957");
  });

  it("expands home only for wikg://~/ archive paths", () => {
    expect(
      parseLocatedWikiGraphUri("wikg://~/Downloads/book.wikg/chapter/1"),
    ).toStrictEqual({
      archivePath: resolve(homedir(), "Downloads/book.wikg"),
      objectUri: "wikg://chapter/1",
    });
    expect(parseLocatedWikiGraphUri("wikg:///tmp/~/book.wikg")).toStrictEqual({
      archivePath: "/tmp/~/book.wikg",
    });
    expect(parseLocatedWikiGraphUri("wikg://~user/book.wikg")).toStrictEqual({
      archivePath: resolve("~user/book.wikg"),
    });
  });
});
