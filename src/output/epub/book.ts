import type { ReadonlyDocument } from "../../document/index.js";
import type { TocItem } from "../../source/index.js";

import { createCoverImageHref } from "./archive.js";
import { createFallbackSection, createSectionDocument } from "./content.js";
import type { EpubBook, EpubSection } from "./model.js";
import { buildNavItems, createNavDocument } from "./navigation.js";
import { createPackageOpf } from "./package.js";
import { normalizeLanguage } from "./shared.js";

export async function buildEpubBook(
  document: ReadonlyDocument,
): Promise<EpubBook> {
  const [meta, toc, cover] = await Promise.all([
    document.readBookMeta(),
    document.readToc(),
    document.readCover(),
  ]);

  if (meta === undefined) {
    throw new Error("Document book meta is missing");
  }
  if (toc === undefined) {
    throw new Error("Document TOC is missing");
  }

  const sectionMap = new Map<number, EpubSection>();
  const language = normalizeLanguage(meta.language);
  const sections = await collectSections(
    document,
    language,
    toc.items,
    sectionMap,
  );
  const navItems = buildNavItems(toc.items, sectionMap);

  if (sections.length === 0) {
    sections.push(createFallbackSection(meta, language));
  }

  const coverImageHref =
    cover === undefined ? undefined : createCoverImageHref(cover);
  const coverPageHref = cover === undefined ? undefined : "text/cover.xhtml";

  return {
    cover,
    meta,
    navXhtml: createNavDocument(meta, language, navItems),
    packageOpf: createPackageOpf({
      coverImageHref,
      coverMediaType: cover?.mediaType,
      coverPageHref,
      language,
      meta,
      modifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
      sections,
    }),
    sections,
  };
}

async function collectSections(
  document: ReadonlyDocument,
  language: string,
  items: readonly TocItem[],
  sectionMap: Map<number, EpubSection>,
): Promise<EpubSection[]> {
  const sections: EpubSection[] = [];

  for (const item of items) {
    if (item.serialId !== undefined) {
      const summary = await document.readSummary(item.serialId);

      if (summary === undefined) {
        throw new Error(
          `Chapter ${item.serialId} summary is missing. Run \`wikigraph <chapter-uri> queue add --task reading-summary --accept-cost\` before export, or inspect the archive with \`wikigraph <archive-uri>/chapter/tree get\`.`,
        );
      }

      const section = createSectionDocument(
        item.serialId,
        language,
        item.title,
        summary,
      );

      sectionMap.set(item.serialId, section);
      sections.push(section);
    }

    sections.push(
      ...(await collectSections(document, language, item.children, sectionMap)),
    );
  }

  return sections;
}
