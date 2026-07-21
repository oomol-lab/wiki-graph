import { createWriteStream } from "fs";
import { dirname, extname } from "path";
import { finished } from "stream/promises";

import { mkdir } from "fs/promises";
import { ZipFile } from "yazl";

import type { BookMeta, SourceAsset } from "../../source/index.js";

import type { EpubBook } from "./model.js";
import { normalizeLanguage } from "./shared.js";
import { renderCoverPage } from "./templates.js";

const EPUB_CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export async function writeEpubArchive(
  path: string,
  book: EpubBook,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const zip = new ZipFile();

  zip.addBuffer(Buffer.from("application/epub+zip"), "mimetype", {
    compress: false,
  });
  zip.addBuffer(
    Buffer.from(EPUB_CONTAINER_XML, "utf8"),
    "META-INF/container.xml",
  );
  zip.addBuffer(Buffer.from(book.packageOpf, "utf8"), "OEBPS/package.opf");
  zip.addBuffer(Buffer.from(book.navXhtml, "utf8"), "OEBPS/nav.xhtml");

  for (const section of book.sections) {
    zip.addBuffer(Buffer.from(section.xhtml, "utf8"), `OEBPS/${section.href}`);
  }

  if (book.cover !== undefined) {
    const coverImageHref = createCoverImageHref(book.cover);
    const language = normalizeLanguage(book.meta.language);

    zip.addBuffer(Buffer.from(book.cover.data), `OEBPS/${coverImageHref}`);
    zip.addBuffer(
      Buffer.from(createCoverPage(book.meta, coverImageHref, language), "utf8"),
      "OEBPS/text/cover.xhtml",
    );
  }

  zip.end();

  const output = createWriteStream(path);
  const outputDone = finished(output);
  const zipDone = finished(zip.outputStream);

  zip.outputStream.pipe(output);
  await Promise.all([outputDone, zipDone]);
}

export function createCoverImageHref(cover: SourceAsset): string {
  return `images/cover${normalizeCoverExtension(cover)}`;
}

function createCoverPage(
  meta: BookMeta,
  coverImageHref: string,
  language: string,
): string {
  const title = meta.title?.trim() || "Untitled";

  return renderCoverPage({
    coverImageHref,
    language,
    title,
  });
}

function normalizeCoverExtension(cover: SourceAsset): string {
  const pathExtension = extname(cover.path).toLowerCase();

  if (pathExtension !== "") {
    return pathExtension;
  }

  switch (cover.mediaType) {
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}
