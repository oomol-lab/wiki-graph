import { posix } from "path";

import { BOOK_META_VERSION, type BookMeta } from "../meta.js";
import { splitHref } from "./archive.js";
import type { EpubArchive } from "./archive.js";
import {
  findChild,
  findChildren,
  getAttribute,
  getDescendantText,
  getLocalName,
  parseXml,
  type XmlElement,
} from "./xml.js";

const COVER_ITEM_IDS = ["cover-image", "coverimg", "cover-img", "cover"];
const GUIDE_NON_CONTENT_TYPES = new Set([
  "cover",
  "titlepage",
  "other.titlepage",
]);

export interface EpubManifestItem {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  readonly properties: ReadonlySet<string>;
}

export interface EpubSpineItem {
  readonly idref: string;
  readonly path: string;
  readonly mediaType: string;
}

export interface EpubPackageData {
  readonly version: 2 | 3;
  readonly opfPath: string;
  readonly metadata: BookMeta;
  readonly manifest: ReadonlyMap<string, EpubManifestItem>;
  readonly manifestByPath: ReadonlyMap<string, EpubManifestItem>;
  readonly spine: readonly EpubSpineItem[];
  readonly navPath: string | undefined;
  readonly ncxPath: string | undefined;
  readonly coverPath: string | undefined;
  readonly coverMediaType: string | undefined;
  readonly guideNonContentPaths: ReadonlySet<string>;
}

export async function readEpubPackage(
  archive: EpubArchive,
): Promise<EpubPackageData> {
  const opfPath = await findOpfPath(archive);
  const opf = parseXml(await archive.readText(opfPath));
  const version = parsePackageVersion(getAttribute(opf, "version"));
  const metadataElement = findChild(opf, "metadata");
  const manifestElement = findChild(opf, "manifest");
  const spineElement = findChild(opf, "spine");
  const guideElement = findChild(opf, "guide");

  const manifest = buildManifest(archive, opfPath, manifestElement);
  const manifestByPath = new Map(
    [...manifest.values()].map((item) => [item.path, item]),
  );
  const spine = buildSpine(spineElement, manifest);
  const guideNonContentPaths = buildGuideNonContentPaths(
    archive,
    opfPath,
    guideElement,
  );
  const metadata = buildMetadata(metadataElement);
  const navPath = findNavPath(manifest);
  const ncxPath = findNcxPath(manifest, spineElement);
  const coverItem = findCoverItem(manifest, metadataElement);

  return {
    version,
    opfPath,
    metadata: {
      ...metadata,
      version: BOOK_META_VERSION,
      sourceFormat: "epub",
    },
    manifest,
    manifestByPath,
    spine,
    navPath,
    ncxPath,
    coverPath: coverItem?.path,
    coverMediaType: coverItem?.mediaType,
    guideNonContentPaths,
  };
}

async function findOpfPath(archive: EpubArchive): Promise<string> {
  const container = parseXml(await archive.readText("META-INF/container.xml"));
  const rootfiles = findChild(container, "rootfiles");
  const rootfile = rootfiles?.children.find(
    (child) => getLocalName(child.name) === "rootfile",
  );
  const fullPath =
    rootfile === undefined ? undefined : getAttribute(rootfile, "full-path");

  if (fullPath === undefined || fullPath.trim() === "") {
    throw new Error("EPUB container.xml does not contain an OPF rootfile");
  }

  return fullPath;
}

function parsePackageVersion(version: string | undefined): 2 | 3 {
  return version?.trim().startsWith("3") === true ? 3 : 2;
}

function buildMetadata(metadataElement: XmlElement | undefined): BookMeta {
  if (metadataElement === undefined) {
    return createEmptyMetadata();
  }

  const titles = readMetadataValues(metadataElement, "title");
  const creators = readMetadataValues(metadataElement, "creator");
  const languages = readMetadataValues(metadataElement, "language");
  const identifiers = readMetadataValues(metadataElement, "identifier");
  const publishers = readMetadataValues(metadataElement, "publisher");
  const dates = readMetadataValues(metadataElement, "date");
  const descriptions = readMetadataValues(metadataElement, "description");

  return {
    ...createEmptyMetadata(),
    title: titles[0] ?? null,
    authors: [...creators],
    language: languages[0] ?? null,
    identifier: identifiers[0] ?? null,
    publisher: publishers[0] ?? null,
    publishedAt: dates[0] ?? null,
    description: descriptions[0] ?? null,
  };
}

function createEmptyMetadata(): BookMeta {
  return {
    version: BOOK_META_VERSION,
    sourceFormat: "epub",
    title: null,
    authors: [],
    language: null,
    identifier: null,
    publisher: null,
    publishedAt: null,
    description: null,
  };
}

function readMetadataValues(
  metadataElement: XmlElement,
  localName: string,
): readonly string[] {
  return metadataElement.children
    .filter((child) => getLocalName(child.name) === localName)
    .map((child) => normalizeText(getDescendantText(child)))
    .filter((value): value is string => value !== undefined);
}

function buildManifest(
  archive: EpubArchive,
  opfPath: string,
  manifestElement: XmlElement | undefined,
): ReadonlyMap<string, EpubManifestItem> {
  const manifest = new Map<string, EpubManifestItem>();

  if (manifestElement === undefined) {
    return manifest;
  }

  for (const item of findChildren(manifestElement, "item")) {
    const id = getAttribute(item, "id");
    const href = getAttribute(item, "href");
    const mediaType = getAttribute(item, "media-type") ?? "";

    if (id === undefined || href === undefined) {
      continue;
    }

    manifest.set(id, {
      id,
      path: archive.resolveRelativePath(opfPath, href),
      mediaType,
      properties: new Set(
        (getAttribute(item, "properties") ?? "")
          .split(/\s+/u)
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value !== ""),
      ),
    });
  }

  return manifest;
}

function buildSpine(
  spineElement: XmlElement | undefined,
  manifest: ReadonlyMap<string, EpubManifestItem>,
): readonly EpubSpineItem[] {
  if (spineElement === undefined) {
    return [];
  }

  return findChildren(spineElement, "itemref")
    .map((itemref) => getAttribute(itemref, "idref"))
    .filter((idref): idref is string => idref !== undefined)
    .map((idref) => {
      const item = manifest.get(idref);

      if (
        item === undefined ||
        (item.mediaType !== "application/xhtml+xml" &&
          item.mediaType !== "text/html")
      ) {
        return undefined;
      }

      return {
        idref,
        path: item.path,
        mediaType: item.mediaType,
      } satisfies EpubSpineItem;
    })
    .filter((item): item is EpubSpineItem => item !== undefined);
}

function buildGuideNonContentPaths(
  archive: EpubArchive,
  opfPath: string,
  guideElement: XmlElement | undefined,
): ReadonlySet<string> {
  const paths = new Set<string>();

  if (guideElement === undefined) {
    return paths;
  }

  for (const reference of findChildren(guideElement, "reference")) {
    const type = (getAttribute(reference, "type") ?? "").trim().toLowerCase();
    if (!GUIDE_NON_CONTENT_TYPES.has(type)) {
      continue;
    }

    const href = getAttribute(reference, "href");
    if (href === undefined || href.trim() === "") {
      continue;
    }

    paths.add(archive.resolveRelativePath(opfPath, splitHref(href).path));
  }

  return paths;
}

function findNavPath(
  manifest: ReadonlyMap<string, EpubManifestItem>,
): string | undefined {
  for (const item of manifest.values()) {
    if (item.properties.has("nav")) {
      return item.path;
    }
  }

  return undefined;
}

function findNcxPath(
  manifest: ReadonlyMap<string, EpubManifestItem>,
  spineElement: XmlElement | undefined,
): string | undefined {
  const tocId =
    spineElement === undefined ? undefined : getAttribute(spineElement, "toc");

  if (tocId !== undefined) {
    return manifest.get(tocId)?.path;
  }

  for (const item of manifest.values()) {
    if (item.mediaType === "application/x-dtbncx+xml") {
      return item.path;
    }
  }

  return undefined;
}

function findCoverItem(
  manifest: ReadonlyMap<string, EpubManifestItem>,
  metadataElement: XmlElement | undefined,
): EpubManifestItem | undefined {
  for (const item of manifest.values()) {
    if (
      item.properties.has("cover-image") &&
      item.mediaType.startsWith("image/")
    ) {
      return item;
    }
  }

  const coverId = readCoverIdFromMetadata(metadataElement);
  if (coverId !== undefined) {
    const coverItem = manifest.get(coverId);
    if (coverItem?.mediaType.startsWith("image/") === true) {
      return coverItem;
    }
  }

  for (const coverItemId of COVER_ITEM_IDS) {
    const coverItem = manifest.get(coverItemId);
    if (coverItem?.mediaType.startsWith("image/") === true) {
      return coverItem;
    }
  }

  for (const item of manifest.values()) {
    if (
      item.mediaType.startsWith("image/") &&
      posix.basename(item.path).toLowerCase().includes("cover")
    ) {
      return item;
    }
  }

  return undefined;
}

function readCoverIdFromMetadata(
  metadataElement: XmlElement | undefined,
): string | undefined {
  if (metadataElement === undefined) {
    return undefined;
  }

  for (const meta of findChildren(metadataElement, "meta")) {
    const name = (getAttribute(meta, "name") ?? "").trim().toLowerCase();
    if (name !== "cover") {
      continue;
    }

    const content = getAttribute(meta, "content");
    if (content !== undefined && content.trim() !== "") {
      return content.trim();
    }
  }

  return undefined;
}

function normalizeText(text: string): string | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();

  return normalized === "" ? undefined : normalized;
}
