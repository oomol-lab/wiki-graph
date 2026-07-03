import { resolve } from "path";

import { describe, expect, it } from "vitest";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphObjectUri,
  parseLocatedWikiGraphUri,
} from "../../src/common/wiki-graph-uri.js";

describe("wiki graph URI helpers", () => {
  it("formats located URIs with URL path separators", () => {
    expect(
      formatLocatedWikiGraphUri(
        String.raw`C:\books\book.wikg`,
        formatWikiGraphObjectUri("entity/Q9957"),
      ),
    ).toBe("wikg://C:/books/book.wikg/entity/Q9957");
  });

  it("accepts legacy wkg URI inputs", () => {
    expect(parseLocatedWikiGraphUri("wkg://book.wikg/entity/Q9957")).toEqual({
      archivePath: resolve("book.wikg"),
      objectUri: "wikg://entity/Q9957",
    });
  });
});
