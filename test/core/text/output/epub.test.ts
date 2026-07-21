import { describe, expect, it } from "vitest";

import { createCoverImageHref } from "../../../../packages/core/src/text/output/epub/archive.js";
import {
  createFallbackSection,
  createSectionDocument,
} from "../../../../packages/core/src/text/output/epub/content.js";
import {
  buildNavItems,
  createNavDocument,
} from "../../../../packages/core/src/text/output/epub/navigation.js";
import { createPackageOpf } from "../../../../packages/core/src/text/output/epub/package.js";
import {
  escapeXml,
  normalizeLanguage,
} from "../../../../packages/core/src/text/output/epub/shared.js";

describe("output/epub", () => {
  it("escapes xml and normalizes language values", () => {
    expect(escapeXml(`A&B<"quoted">'single'`)).toBe(
      "A&amp;B&lt;&quot;quoted&quot;&gt;&apos;single&apos;",
    );
    expect(normalizeLanguage("  en-US ")).toBe("en-US");
    expect(normalizeLanguage("  ")).toBe("und");
    expect(normalizeLanguage(null)).toBe("und");
  });

  it("builds nav items and nav documents", () => {
    const sectionMap = new Map([
      [
        1,
        {
          href: "text/serial-1.xhtml",
          id: "serial-1",
          title: "Alpha",
          xhtml: "<html></html>",
        },
      ],
    ]);
    const items = buildNavItems(
      [
        {
          children: [
            {
              children: [],
              title: "Nested <Two>",
            },
          ],
          serialId: 1,
          title: "Root & One",
        },
      ],
      sectionMap,
    );
    const navDocument = createNavDocument(
      {
        authors: [],
        description: null,
        identifier: null,
        language: "en",
        publishedAt: null,
        publisher: null,
        sourceFormat: "epub",
        title: "Book <Title>",
        version: 1,
      },
      "en",
      items,
    );

    expect(items[0]?.href).toBe("text/serial-1.xhtml");
    expect(items[0]?.children[0]?.href).toBeUndefined();
    expect(navDocument).toContain("Root &amp; One");
    expect(navDocument).toContain("Nested &lt;Two&gt;");
    expect(navDocument).toContain("Book &lt;Title&gt;");
  });

  it("builds section content and package metadata", () => {
    const fallbackSection = createFallbackSection(
      {
        authors: [],
        description: null,
        identifier: null,
        language: null,
        publishedAt: null,
        publisher: null,
        sourceFormat: "epub",
        title: "Fallback Book",
        version: 1,
      },
      "und",
    );
    const section = createSectionDocument(
      7,
      "en",
      "  ",
      "Alpha line.\n\nBeta line\nwrapped.",
    );
    const packageOpf = createPackageOpf({
      coverImageHref: "images/cover.png",
      coverMediaType: "image/png",
      coverPageHref: "text/cover.xhtml",
      language: "en",
      meta: {
        authors: ["Ari Lantern"],
        description: "Fixture book",
        identifier: "urn:test:fixture",
        language: "en",
        publishedAt: "2026-01-01",
        publisher: "Open Sample Press",
        sourceFormat: "epub",
        title: "Fixture Book",
        version: 1,
      },
      modifiedAt: "2026-01-01T00:00:00Z",
      sections: [section],
    });

    expect(fallbackSection.title).toBe("Fallback Book");
    expect(section.title).toBe("Section 7");
    expect(section.xhtml).toContain("Alpha line.");
    expect(section.xhtml).toContain("Beta line wrapped.");
    expect(packageOpf).toContain("urn:test:fixture");
    expect(packageOpf).toContain("Fixture Book");
    expect(packageOpf).toContain("text/serial-7.xhtml");
  });

  it("derives cover image paths from file extension or media type", () => {
    expect(
      createCoverImageHref({
        data: Buffer.from([1]),
        mediaType: "image/png",
        path: "art/cover.custom.png",
      }),
    ).toBe("images/cover.png");

    expect(
      createCoverImageHref({
        data: Buffer.from([1]),
        mediaType: "image/webp",
        path: "cover-image",
      }),
    ).toBe("images/cover.webp");
  });
});
