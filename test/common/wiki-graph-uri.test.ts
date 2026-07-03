import { describe, expect, it } from "vitest";

import {
  formatLocatedWikiGraphUri,
  formatWikiGraphObjectUri,
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
});
