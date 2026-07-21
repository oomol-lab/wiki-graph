import type { Readable } from "stream";

import { Parser } from "htmlparser2";

import type { SourceTextStream } from "../types.js";
import type { EpubArchive } from "./archive.js";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const SKIPPED_TAGS = new Set(["script", "style"]);

export interface EpubSectionTarget {
  readonly id: string;
  readonly path: string;
  readonly fragment: string | undefined;
}

export interface EpubSectionAnalysis {
  readonly hasContent: boolean;
  readonly wordsCount: number;
}

export class EpubContentLoader {
  readonly #archive: EpubArchive;
  readonly #targetsBySectionId: ReadonlyMap<
    string,
    {
      readonly path: string;
      readonly targets: readonly EpubSectionTarget[];
    }
  >;

  public constructor(
    archive: EpubArchive,
    targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
  ) {
    this.#archive = archive;
    this.#targetsBySectionId = createTargetsBySectionId(targetsByPath);
  }

  public async openSection(sectionId: string): Promise<SourceTextStream> {
    const target = this.#targetsBySectionId.get(sectionId);

    if (target === undefined) {
      return [];
    }

    const sections = await this.#parseSections(target.path, target.targets);

    return [sections.get(sectionId) ?? ""];
  }

  async #parseSections(
    path: string,
    targets: readonly EpubSectionTarget[],
  ): Promise<ReadonlyMap<string, string>> {
    const stream = await this.#archive.openReadStream(path);
    stream.setEncoding("utf8");

    return await parseHtmlSections(stream, targets);
  }
}

export async function analyzeSectionTargets(
  archive: Pick<EpubArchive, "openReadStream">,
  targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
): Promise<ReadonlyMap<string, EpubSectionAnalysis>> {
  const analyses = new Map<string, EpubSectionAnalysis>();

  for (const [path, targets] of targetsByPath.entries()) {
    const stream = await archive.openReadStream(path);
    stream.setEncoding("utf8");
    const sections = await parseHtmlSectionTexts(stream, targets);

    for (const target of targets) {
      const text = sections.get(target.id) ?? "";

      analyses.set(target.id, {
        hasContent: text.trim() !== "",
        wordsCount: countWords(text),
      });
    }
  }

  return analyses;
}

function createTargetsBySectionId(
  targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
): ReadonlyMap<
  string,
  {
    readonly path: string;
    readonly targets: readonly EpubSectionTarget[];
  }
> {
  const targetsBySectionId = new Map<
    string,
    {
      readonly path: string;
      readonly targets: readonly EpubSectionTarget[];
    }
  >();

  for (const [path, targets] of targetsByPath.entries()) {
    for (const target of targets) {
      targetsBySectionId.set(target.id, { path, targets });
    }
  }

  return targetsBySectionId;
}

async function parseHtmlSections(
  stream: Readable,
  targets: readonly EpubSectionTarget[],
): Promise<ReadonlyMap<string, string>> {
  return await parseHtmlSectionTexts(stream, targets);
}

async function parseHtmlSectionTexts(
  stream: Readable,
  targets: readonly EpubSectionTarget[],
): Promise<ReadonlyMap<string, string>> {
  const fragments = new Map<string, number>();
  const sections = new Map<string, string>();
  const orderedTargets = [...targets];
  const buffers = orderedTargets.map(() => "");
  const rootSectionIndex =
    orderedTargets[0]?.fragment === undefined && orderedTargets[0] !== undefined
      ? 0
      : -1;
  let currentIndex = rootSectionIndex;
  let skippedTagDepth = 0;

  orderedTargets.forEach((target, index) => {
    sections.set(target.id, "");
    if (target.fragment !== undefined && !fragments.has(target.fragment)) {
      fragments.set(target.fragment, index);
    }
  });

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const tagName = name.toLowerCase();
        if (SKIPPED_TAGS.has(tagName)) {
          skippedTagDepth += 1;
          return;
        }

        const anchorId = attributes.id ?? attributes["xml:id"];
        if (anchorId !== undefined) {
          const nextIndex = fragments.get(anchorId);
          if (nextIndex !== undefined && nextIndex > currentIndex) {
            currentIndex = nextIndex;
          }
        }

        if (tagName === "br") {
          appendText(buffers, currentIndex, "\n");
        }
      },
      ontext(text) {
        if (skippedTagDepth > 0) {
          return;
        }

        appendText(buffers, currentIndex, text);
      },
      onclosetag(name) {
        const tagName = name.toLowerCase();
        if (SKIPPED_TAGS.has(tagName)) {
          skippedTagDepth = Math.max(0, skippedTagDepth - 1);
          return;
        }

        if (BLOCK_TAGS.has(tagName)) {
          appendText(buffers, currentIndex, "\n\n");
        }
      },
    },
    { decodeEntities: true },
  );

  for await (const chunk of stream as AsyncIterable<unknown>) {
    parser.write(toTextChunk(chunk));
  }

  parser.end();

  orderedTargets.forEach((target, index) => {
    sections.set(target.id, normalizeSectionText(buffers[index] ?? ""));
  });

  return sections;
}

function appendText(
  buffers: string[],
  currentIndex: number,
  text: string,
): void {
  if (currentIndex < 0 || currentIndex >= buffers.length) {
    return;
  }

  buffers[currentIndex] += text;
}

function normalizeSectionText(text: string): string {
  return text
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function toTextChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  throw new Error("Unexpected HTML stream chunk type");
}

function countWords(text: string): number {
  return [...createWordSegmenter().segment(text)].filter(
    (segment) => segment.isWordLike,
  ).length;
}

let WORD_SEGMENTER: Intl.Segmenter | undefined;

function createWordSegmenter(): Intl.Segmenter {
  if (WORD_SEGMENTER === undefined) {
    WORD_SEGMENTER = new Intl.Segmenter(undefined, {
      granularity: "word",
    });
  }

  return WORD_SEGMENTER;
}
