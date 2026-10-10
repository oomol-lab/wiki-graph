import { SaxesParser, type SaxesTagPlain } from "saxes";

import type {
  SourceArtifactInput,
  SourceTextMappingInput,
} from "../../../document/types.js";
import type { File } from "../../../runtime/platform/index.js";
import { countTextWords } from "../../../utils/text-word-count.js";
import type { SourceAdapter, SourceDocument } from "../adapter.js";
import type {
  SourceSection,
  SourceSectionContent,
  SourceTextStream,
} from "../types.js";
import {
  findChildren,
  getAttribute,
  parseXml,
  type XmlElement,
} from "../epub/xml.js";
import { PcexArchive } from "./archive.js";

export interface PcexSourceOptions {
  readonly pdfDigest: string;
  readonly pdfName?: string;
}

interface PageSize {
  readonly width: number;
  readonly height: number;
}
interface Segment {
  readonly bbox: readonly [number, number, number, number];
  readonly pageIndex: number;
  readonly sourceEnd: number;
  readonly sourceStart: number;
  readonly text: string;
}
type RawSegment = Omit<Segment, "sourceEnd" | "sourceStart">;
interface Chapter {
  readonly id: string;
  readonly title?: string;
  readonly text: string;
  readonly segments: readonly Segment[];
}

interface PcexTocItem {
  readonly id: string;
  readonly children: readonly PcexTocItem[];
}

interface PcexSectionDefinition {
  readonly chapter?: Chapter;
  readonly children: readonly PcexSectionDefinition[];
  readonly id: string;
  readonly title?: string;
}

class PcexSection implements SourceSection {
  readonly #artifact: SourceArtifactInput;
  readonly #definition: PcexSectionDefinition;
  public constructor(
    definition: PcexSectionDefinition,
    artifact: SourceArtifactInput,
  ) {
    this.#artifact = artifact;
    this.#definition = definition;
  }
  public get children(): readonly SourceSection[] {
    return this.#definition.children.map(
      (child) => new PcexSection(child, this.#artifact),
    );
  }
  public get hasContent(): boolean {
    return (this.#definition.chapter?.text.length ?? 0) > 0;
  }
  public get wordsCount(): number {
    return countTextWords(this.#definition.chapter?.text ?? "");
  }
  public get id(): string {
    return this.#definition.id;
  }
  public get title(): string | undefined {
    return this.#definition.title;
  }
  public open(): Promise<SourceTextStream> {
    return Promise.resolve([this.#definition.chapter?.text ?? ""]);
  }
  public openWithProvenance(): Promise<SourceSectionContent> {
    const mappings: SourceTextMappingInput[] = (
      this.#definition.chapter?.segments ?? []
    ).map((segment) => ({
      artifactDigest: this.#artifact.digest,
      locator: { bbox: segment.bbox, pageIndex: segment.pageIndex },
      sourceEnd: segment.sourceEnd,
      sourceStart: segment.sourceStart,
    }));
    if (
      (this.#definition.chapter?.text.length ?? 0) > 0 &&
      mappings.length === 0
    ) {
      throw new Error(
        `PCEX section ${this.#definition.id} produced text without provenance mappings.`,
      );
    }
    return Promise.resolve({
      provenance: { artifacts: [this.#artifact], mappings },
      stream: [this.#definition.chapter?.text ?? ""],
    });
  }
}

class PcexDocument implements SourceDocument {
  readonly #artifact: SourceArtifactInput;
  readonly #sections: readonly PcexSectionDefinition[];
  readonly #meta: ReturnType<typeof readManifest>;
  public constructor(
    artifact: SourceArtifactInput,
    meta: ReturnType<typeof readManifest>,
    sections: readonly PcexSectionDefinition[],
  ) {
    this.#artifact = artifact;
    this.#sections = sections;
    this.#meta = meta;
  }
  public readMeta() {
    return Promise.resolve(this.#meta);
  }
  public readCover() {
    return Promise.resolve(undefined);
  }
  public readSections() {
    return Promise.resolve(
      this.#sections.map((section) => new PcexSection(section, this.#artifact)),
    );
  }
}

export class PcexSourceAdapter implements SourceAdapter {
  readonly #options: PcexSourceOptions;
  public constructor(options: PcexSourceOptions) {
    this.#options = options;
  }
  public get format() {
    return "pdf" as const;
  }
  public async openSession<T>(
    file: File,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T> {
    const archive = await PcexArchive.open(file);
    try {
      requireEntries(archive);
      const manifest = readManifest(
        JSON.parse(await archive.readText("manifest.json")) as unknown,
      );
      const pages = readPages(await archive.readText("pages.xml"));
      const toc = archive.hasEntry("toc.xml")
        ? readToc(await archive.readText("toc.xml"))
        : undefined;
      const chapterPaths = archive
        .listEntries()
        .filter((path) =>
          /^chapters\/chapter_(?:head|[0-9]+)\.xml$/u.test(path),
        )
        .sort(compareChapterPaths);
      const chapters = await Promise.all(
        chapterPaths.map(async (path) =>
          readChapter(await archive.readText(path), pages, path),
        ),
      );
      const pdfName = normalizeOptional(this.#options.pdfName);
      const artifact: SourceArtifactInput = {
        digest: normalizeDigest(this.#options.pdfDigest),
        mediaType: "application/pdf",
        ...(pdfName === undefined ? {} : { name: pdfName }),
      };
      return await operation(
        new PcexDocument(artifact, manifest, buildSections(chapters, toc)),
      );
    } finally {
      await archive.close();
    }
  }
}

function requireEntries(archive: PcexArchive): void {
  for (const path of ["manifest.json", "pages.xml"]) {
    if (!archive.hasEntry(path))
      throw new Error(`PCEX is missing required entry ${path}.`);
  }
  if (!archive.listEntries().some((path) => path.startsWith("chapters/")))
    throw new Error("PCEX is missing chapters directory.");
}

function readManifest(value: unknown) {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.format_version) ||
    (value.format_version as number) < 1 ||
    (value.format_version as number) > 4 ||
    !isRecord(value.document)
  ) {
    throw new Error("PCEX manifest.json is invalid or unsupported.");
  }
  const document = value.document;
  return {
    version: 1 as const,
    sourceFormat: "pdf" as const,
    title: optionalString(document.title),
    authors: Array.isArray(document.authors)
      ? document.authors.flatMap((author) =>
          isRecord(author) &&
          typeof author.name === "string" &&
          author.name.trim() !== ""
            ? [author.name.trim()]
            : typeof author === "string" && author.trim() !== ""
              ? [author.trim()]
              : [],
        )
      : [],
    language: optionalString(document.language),
    identifier: optionalString(document.isbn),
    publisher: optionalString(document.publisher),
    publishedAt: optionalString(document.publication_date),
    description: optionalString(document.description),
  };
}

function readPages(xml: string): ReadonlyMap<number, PageSize> {
  const root = parseXml(xml);
  if (
    root.name !== "pages" ||
    root.attributes.index_base !== "1" ||
    root.attributes.coordinate_space !== "ocr_pixels"
  )
    throw new Error("PCEX pages.xml uses an unsupported coordinate system.");
  const pages = new Map<number, PageSize>();
  for (const page of findChildren(root, "page")) {
    const index = positiveInteger(getAttribute(page, "index"), "page index");
    const width = positiveInteger(getAttribute(page, "width"), "page width");
    const height = positiveInteger(getAttribute(page, "height"), "page height");
    if (pages.has(index))
      throw new Error(`PCEX pages.xml contains duplicate page ${index}.`);
    pages.set(index, { width, height });
  }
  return pages;
}

function readChapter(
  xml: string,
  pages: ReadonlyMap<number, PageSize>,
  path: string,
): Chapter {
  const { segments, text } = parseFlow(xml, pages);
  const firstHeading = readFirstHeading(xml);
  return {
    id: path,
    ...(firstHeading === undefined ? {} : { title: firstHeading }),
    text,
    segments,
  };
}

function readToc(xml: string): readonly PcexTocItem[] {
  const root = parseXml(xml);
  if (root.name !== "toc") {
    throw new Error("PCEX toc.xml must have a toc root element.");
  }

  return findChildren(root, "item").map((item) => readTocItem(item));
}

function readTocItem(element: XmlElement): PcexTocItem {
  const id = getAttribute(element, "id");
  if (id === undefined || !/^\d+$/u.test(id)) {
    throw new Error("PCEX toc item id must be an integer.");
  }

  return {
    id,
    children: findChildren(element, "item").map((child) => readTocItem(child)),
  };
}

function buildSections(
  chapters: readonly Chapter[],
  toc: readonly PcexTocItem[] | undefined,
): readonly PcexSectionDefinition[] {
  const chaptersById = new Map(
    chapters
      .filter((chapter) => !chapter.id.endsWith("chapter_head.xml"))
      .map((chapter) => [chapterFileId(chapter.id), chapter]),
  );
  const referenced = new Set<string>();
  const sections: PcexSectionDefinition[] = [];

  const head = chapters.find((chapter) =>
    chapter.id.endsWith("chapter_head.xml"),
  );
  if (head !== undefined) sections.push(createSection(head));

  if (toc === undefined) {
    sections.push(
      ...chapters
        .filter((chapter) => chapter !== head)
        .map((chapter) => createSection(chapter)),
    );
    return sections;
  }

  const createTocSection = (item: PcexTocItem): PcexSectionDefinition => {
    const chapter = chaptersById.get(item.id);
    if (chapter === undefined && item.children.length === 0) {
      throw new Error(`PCEX toc item ${item.id} has no matching chapter.`);
    }
    if (chapter !== undefined) referenced.add(item.id);
    return {
      ...(chapter === undefined ? {} : { chapter }),
      children: item.children.map(createTocSection),
      id: chapter?.id ?? `toc:${item.id}`,
      ...(chapter?.title === undefined ? {} : { title: chapter.title }),
    };
  };

  sections.push(...toc.map(createTocSection));
  sections.push(
    ...chapters
      .filter(
        (chapter) =>
          chapter !== head && !referenced.has(chapterFileId(chapter.id)),
      )
      .map((chapter) => createSection(chapter)),
  );
  return sections;
}

function createSection(chapter: Chapter): PcexSectionDefinition {
  return {
    chapter,
    children: [],
    id: chapter.id,
    ...(chapter.title === undefined ? {} : { title: chapter.title }),
  };
}

function chapterFileId(path: string): string {
  const match = /chapter_([0-9]+)\.xml$/u.exec(path);
  if (match?.[1] === undefined) {
    throw new Error(`PCEX chapter path has no numeric id: ${path}`);
  }
  return match[1];
}

function parseFlow(
  xml: string,
  pages: ReadonlyMap<number, PageSize>,
): Pick<Chapter, "segments" | "text"> {
  const parser = new SaxesParser({ xmlns: false });
  const items: (readonly RawSegment[])[] = [];
  const stack: string[] = [];
  let item: { depth: number; segments: RawSegment[] } | undefined;
  let capture:
    | {
        depth: number;
        pageIndex: number;
        bbox: readonly [number, number, number, number];
        text: string;
      }
    | undefined;
  let depth = 0;
  parser.on("opentag", (tag: SaxesTagPlain) => {
    depth += 1;
    const parent = stack[stack.length - 1];
    stack.push(tag.name);
    if (
      item === undefined &&
      ((parent === "flow" &&
        (tag.name === "text" ||
          tag.name === "display-formula" ||
          tag.name === "standalone-asset")) ||
        (parent === "body" &&
          (tag.name === "paragraph" || tag.name === "asset")))
    ) {
      item = { depth, segments: [] };
    }
    if (capture !== undefined) return;
    if (item === undefined) return;
    if (tag.name !== "fragment" && tag.name !== "block" && tag.name !== "asset")
      return;
    const pageIndex = positiveInteger(
      attribute(tag, "page_index"),
      `${tag.name} page_index`,
    );
    const size = pages.get(pageIndex);
    if (size === undefined)
      throw new Error(
        `PCEX chapter references page ${pageIndex} missing from pages.xml.`,
      );
    const raw =
      attribute(tag, tag.name === "block" ? "det" : "bbox") ??
      attribute(tag, "bbox");
    capture = { depth, pageIndex, bbox: normalizeBbox(raw, size), text: "" };
  });
  const append = (text: string) => {
    if (capture !== undefined) capture.text += text;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (capture?.depth === depth) {
      const text = normalizeSegmentText(capture.text);
      if (text !== "") {
        item?.segments.push({
          bbox: capture.bbox,
          pageIndex: capture.pageIndex,
          text,
        });
      }
      capture = undefined;
    }
    if (item?.depth === depth) {
      const normalized = normalizeItemSegments(item.segments);
      if (normalized.length > 0) items.push(normalized);
      item = undefined;
    }
    stack.pop();
    depth -= 1;
  });
  parser.write(xml).close();
  return buildFlow(items);
}

function normalizeItemSegments(
  segments: readonly RawSegment[],
): readonly RawSegment[] {
  const normalized = segments.map((segment) => ({ ...segment }));
  while (normalized[0]?.text.trim() === "") normalized.shift();
  while (normalized.at(-1)?.text.trim() === "") normalized.pop();
  if (normalized.length === 0) return normalized;

  normalized[0] = {
    ...normalized[0]!,
    text: normalized[0]!.text.trimStart(),
  };
  const last = normalized.length - 1;
  normalized[last] = {
    ...normalized[last]!,
    text: normalized[last]!.text.trimEnd(),
  };
  for (let index = 1; index < normalized.length; index += 1) {
    if (
      normalized[index - 1]!.text.endsWith(" ") &&
      normalized[index]!.text.startsWith(" ")
    ) {
      normalized[index] = {
        ...normalized[index]!,
        text: normalized[index]!.text.slice(1),
      };
    }
  }
  return normalized.filter((segment) => segment.text !== "");
}

function buildFlow(
  items: readonly (readonly RawSegment[])[],
): Pick<Chapter, "segments" | "text"> {
  const parts: string[] = [];
  const segments: Segment[] = [];
  let sourceOffset = 0;
  for (const item of items) {
    if (parts.length > 0) {
      parts.push("\n\n");
      sourceOffset += 2;
    }
    for (const segment of item) {
      const sourceStart = sourceOffset;
      parts.push(segment.text);
      sourceOffset += Array.from(segment.text).length;
      segments.push({ ...segment, sourceEnd: sourceOffset, sourceStart });
    }
  }
  return { segments, text: parts.join("") };
}

function readFirstHeading(xml: string): string | undefined {
  const root = parseXml(xml);
  const flow = root.children.find((child) => child.name === "flow");
  const heading = flow?.children.find(
    (child) => child.name === "text" && child.attributes.role === "heading",
  );
  return heading === undefined
    ? undefined
    : normalizeOptional(descendantText(heading));
}

function descendantText(element: XmlElement): string {
  return element.text + element.children.map(descendantText).join("");
}
function compareChapterPaths(left: string, right: string): number {
  if (left.endsWith("chapter_head.xml")) return -1;
  if (right.endsWith("chapter_head.xml")) return 1;
  return (
    Number(/chapter_([0-9]+)/u.exec(left)?.[1]) -
    Number(/chapter_([0-9]+)/u.exec(right)?.[1])
  );
}
function normalizeBbox(
  value: string | undefined,
  size: PageSize,
): readonly [number, number, number, number] {
  const values = value?.split(",").map(Number);
  if (
    values === undefined ||
    values.length !== 4 ||
    values.some((part) => !Number.isFinite(part))
  )
    throw new Error("PCEX source bbox must contain four numbers.");
  const [left, top, right, bottom] = values as [number, number, number, number];
  if (
    left < 0 ||
    top < 0 ||
    right <= left ||
    bottom <= top ||
    right > size.width ||
    bottom > size.height
  )
    throw new Error("PCEX source bbox is outside its page.");
  return [
    left / size.width,
    1 - bottom / size.height,
    right / size.width,
    1 - top / size.height,
  ];
}
function attribute(tag: SaxesTagPlain, name: string): string | undefined {
  const value = tag.attributes[name];
  return value === undefined ? undefined : String(value);
}
function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`PCEX ${label} must be a positive integer.`);
  return parsed;
}
function normalizeDigest(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(result))
    throw new Error("PCEX source PDF digest must be a SHA-256 hex digest.");
  return result;
}
function normalizeSegmentText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ");
}
function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
