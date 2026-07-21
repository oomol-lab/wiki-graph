import type { BookMeta } from "../../source/index.js";

import type { EpubSection } from "./model.js";
import { renderPackageOpf } from "./templates.js";

export const EPUB_OUTPUT_VERSION = "3.0";

export function createPackageOpf(input: {
  readonly coverImageHref: string | undefined;
  readonly coverMediaType: string | undefined;
  readonly coverPageHref: string | undefined;
  readonly language: string;
  readonly meta: BookMeta;
  readonly modifiedAt: string;
  readonly sections: readonly EpubSection[];
}): string {
  const identifier =
    input.meta.identifier?.trim() || `urn:uuid:${crypto.randomUUID()}`;
  const title = input.meta.title?.trim() || "Untitled";

  return renderPackageOpf({
    authors: input.meta.authors,
    coverImageHref: input.coverImageHref,
    coverMediaType: input.coverMediaType,
    coverPageHref: input.coverPageHref,
    description: input.meta.description,
    identifier,
    language: input.language,
    modifiedAt: input.modifiedAt,
    publishedAt: input.meta.publishedAt,
    publisher: input.meta.publisher,
    sections: input.sections.map((section) => ({
      href: section.href,
      id: section.id,
    })),
    title,
    version: EPUB_OUTPUT_VERSION,
  });
}
