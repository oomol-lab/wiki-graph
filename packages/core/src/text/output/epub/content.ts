import type { BookMeta } from "../../source/index.js";

import type { EpubSection } from "./model.js";
import { renderSectionDocument } from "./templates.js";

export function createFallbackSection(
  meta: BookMeta,
  language: string,
): EpubSection {
  const title = meta.title?.trim() || "Untitled";

  return {
    href: "text/section-1.xhtml",
    id: "section-1",
    title,
    xhtml: renderSectionDocument({
      language,
      paragraphs: [],
      title,
    }),
  };
}

export function createSectionDocument(
  serialId: number,
  language: string,
  title: string | null | undefined,
  summary: string,
): EpubSection {
  const normalizedTitle = title?.trim() || `Section ${serialId}`;

  return {
    href: `text/serial-${serialId}.xhtml`,
    id: `serial-${serialId}`,
    title: normalizedTitle,
    xhtml: renderSectionDocument({
      language,
      paragraphs: splitParagraphs(summary.trim()),
      title: normalizedTitle,
    }),
  };
}

function splitParagraphs(summary: string): string[] {
  return summary
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/gu, " ").trim())
    .filter((paragraph) => paragraph !== "");
}
