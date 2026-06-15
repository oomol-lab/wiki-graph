import type { Document } from "../document/index.js";
import type { Language } from "../common/language.js";
import type { SpineDigestScope } from "../common/llm-scope.js";
import type { LLM } from "../llm/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import {
  SerialGeneration,
  writeSerialSource,
  type BuildSerialTopologyOptions,
} from "../serial.js";
import { TOC_FILE_VERSION, type TocItem } from "../source/index.js";

export const CHAPTER_STAGES = [
  "planned",
  "sourced",
  "graphed",
  "summarized",
] as const;

export type ChapterStage = (typeof CHAPTER_STAGES)[number];

export interface ChapterEntry {
  readonly chapterId: number;
  readonly childCount: number;
  readonly depth: number;
  readonly fragmentCount: number;
  readonly stage: ChapterStage;
  readonly title: string | null;
  readonly tocPath: readonly string[];
}

export interface ChapterDetails extends ChapterEntry {
  readonly graphReady: boolean;
  readonly hasSummary: boolean;
}

export interface AdvanceChapterStagesOptions {
  readonly chapterId?: number;
  readonly extractionPrompt: string;
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly targetStage: ChapterStage;
  readonly userLanguage?: Language;
}

export interface AdvanceChapterStagesResult {
  readonly advanced: readonly ChapterEntry[];
  readonly pending: readonly ChapterEntry[];
  readonly skipped: readonly ChapterEntry[];
}

export interface AddChapterOptions {
  readonly parentChapterId?: number;
  readonly title?: string | null | undefined;
}

export interface GenerateChapterGraphOptions {
  readonly extractionPrompt: string;
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly userLanguage?: Language;
}

export interface GenerateChapterSummaryOptions {
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly userLanguage?: Language;
}

export async function advanceChapterStages(
  document: Document,
  options: AdvanceChapterStagesOptions,
): Promise<AdvanceChapterStagesResult> {
  if (options.targetStage === "planned") {
    return {
      advanced: [],
      pending: await selectChapterEntries(document, options.chapterId),
      skipped: [],
    };
  }

  const advancedIds = new Set<number>();
  const entries = await selectChapterEntries(document, options.chapterId);

  if (isStageBefore("sourced", options.targetStage)) {
    await advanceEntriesToGraphed(document, entries, options, {
      advancedIds,
    });
  }
  if (isStageBefore("graphed", options.targetStage)) {
    const graphedEntries = await selectChapterEntries(
      document,
      options.chapterId,
    );

    await advanceEntriesToSummarized(document, graphedEntries, options, {
      advancedIds,
    });
  }

  const nextEntries = await selectChapterEntries(document, options.chapterId);

  return {
    advanced: nextEntries.filter((entry) => advancedIds.has(entry.chapterId)),
    pending: nextEntries.filter((entry) =>
      isStageBefore(entry.stage, options.targetStage),
    ),
    skipped: nextEntries.filter((entry) => entry.stage === "planned"),
  };
}

export async function addChapter(
  document: Document,
  options: AddChapterOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const normalizedTitle = normalizeTitle(options.title);

    const chapterId = await openedDocument.createSerial();
    const chapterItem = {
      children: [],
      serialId: chapterId,
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
    } satisfies TocItem;

    if (options.parentChapterId === undefined) {
      toc.items = [...toc.items, chapterItem];
    } else if (
      !appendChildToChapter(toc.items, options.parentChapterId, chapterItem)
    ) {
      throw new Error(`Chapter ${options.parentChapterId} does not exist.`);
    }

    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function generateChapterGraph(
  document: Document,
  chapterId: number,
  options: GenerateChapterGraphOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "sourced") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Generate a graph only for sourced chapters.`,
      );
    }

    const generation = new SerialGeneration({
      document: openedDocument,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
    });

    await generation.buildTopologyInto(
      chapterId,
      readChapterSource(openedDocument, chapterId),
      createTopologyOptions(options),
    );
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function generateChapterSummary(
  document: Document,
  chapterId: number,
  options: GenerateChapterSummaryOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "graphed") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Generate a summary only for graphed chapters.`,
      );
    }

    const generation = new SerialGeneration({
      document: openedDocument,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
    });

    await generation.buildSummary(chapterId, {
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function getChapterDetails(
  document: Document,
  chapterId: number,
): Promise<ChapterDetails> {
  const entries = await listChapters(document);
  const entry = entries.find((item) => item.chapterId === chapterId);

  if (entry === undefined) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  const serial = await document.serials.getById(chapterId);
  const summary = await document.readSummary(chapterId);

  return {
    ...entry,
    graphReady: serial?.topologyReady === true,
    hasSummary: summary !== undefined,
  };
}

export async function listChapters(
  document: Document,
): Promise<readonly ChapterEntry[]> {
  const toc = await normalizeChapterToc(document);

  return await collectChapterEntries(document, toc.items);
}

export async function removeChapter(
  document: Document,
  chapterId: number,
  options: { readonly recursive?: boolean } = {},
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const removedChapterIds: number[] = [];
    const result = removeChapterFromItems(toc.items, chapterId, {
      recursive: options.recursive ?? false,
      removedChapterIds,
    });

    if (!result.removed) {
      throw new Error(`Chapter ${chapterId} does not exist.`);
    }

    toc.items = result.items;
    await openedDocument.replaceToc(toc);

    for (const removedChapterId of removedChapterIds) {
      await openedDocument.deleteSerial(removedChapterId);
    }
  });
}

export async function resetChapter(
  document: Document,
  chapterId: number,
  stage: Exclude<ChapterStage, "summarized">,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    await requireChapterDetails(openedDocument, chapterId);

    switch (stage) {
      case "planned":
        await openedDocument.clearSerialSource(chapterId);
        break;
      case "sourced":
        await openedDocument.clearSerialGraph(chapterId);
        break;
      case "graphed":
        await openedDocument.deleteSummary(chapterId);
        break;
    }

    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function setChapterSource(
  document: Document,
  chapterId: number,
  stream: ReaderTextStream,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "planned") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Reset it to planned before setting source.`,
      );
    }

    await writeSerialSource(openedDocument, chapterId, stream);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function setChapterSummary(
  document: Document,
  chapterId: number,
  summary: string,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "graphed") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Set a summary only for graphed chapters.`,
      );
    }

    await openedDocument.writeSummary(chapterId, summary);
    return await getChapterDetails(openedDocument, chapterId);
  });
}

async function normalizeChapterToc(
  document: Document,
): Promise<MutableTocFile> {
  const existingToc = await document.readToc();
  const toc: MutableTocFile =
    existingToc === undefined
      ? { items: [], version: TOC_FILE_VERSION }
      : {
          items: existingToc.items.map(cloneTocItem),
          version: existingToc.version,
        };
  let changed = false;

  const normalizeItems = async (items: MutableTocItem[]): Promise<void> => {
    for (const item of items) {
      if (item.serialId === undefined) {
        item.serialId = await document.createSerial();
        changed = true;
      } else {
        await document.serials.ensure(item.serialId);
      }

      await normalizeItems(item.children);
    }
  };

  await normalizeItems(toc.items);

  if (existingToc === undefined || changed) {
    await document.replaceToc(toc);
  }

  return toc;
}

async function collectChapterEntries(
  document: Document,
  items: readonly TocItem[],
  ancestorTitles: readonly string[] = [],
  depth = 0,
): Promise<ChapterEntry[]> {
  const entries: ChapterEntry[] = [];

  for (const item of items) {
    if (item.serialId === undefined) {
      continue;
    }

    const title = normalizeTitle(item.title) ?? null;
    const tocPath = [...ancestorTitles, title ?? `Chapter ${item.serialId}`];
    const fragmentCount = (
      await document.getSerialFragments(item.serialId).listFragmentIds()
    ).length;

    entries.push({
      chapterId: item.serialId,
      childCount: item.children.length,
      depth,
      fragmentCount,
      stage: await resolveChapterStage(document, item.serialId, fragmentCount),
      title,
      tocPath,
    });
    entries.push(
      ...(await collectChapterEntries(
        document,
        item.children,
        tocPath,
        depth + 1,
      )),
    );
  }

  return entries;
}

async function advanceEntriesToGraphed(
  document: Document,
  entries: readonly ChapterEntry[],
  options: AdvanceChapterStagesOptions,
  state: { readonly advancedIds: Set<number> },
): Promise<readonly ChapterEntry[]> {
  for (const entry of entries) {
    if (entry.stage !== "sourced") {
      continue;
    }

    await generateChapterGraph(document, entry.chapterId, {
      extractionPrompt: options.extractionPrompt,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });
    state.advancedIds.add(entry.chapterId);
  }

  return await selectChapterEntries(document, options.chapterId);
}

async function advanceEntriesToSummarized(
  document: Document,
  entries: readonly ChapterEntry[],
  options: AdvanceChapterStagesOptions,
  state: { readonly advancedIds: Set<number> },
): Promise<readonly ChapterEntry[]> {
  for (const entry of entries) {
    if (entry.stage !== "graphed") {
      continue;
    }

    await generateChapterSummary(document, entry.chapterId, {
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });
    state.advancedIds.add(entry.chapterId);
  }

  return await selectChapterEntries(document, options.chapterId);
}

async function selectChapterEntries(
  document: Document,
  chapterId: number | undefined,
): Promise<readonly ChapterEntry[]> {
  const entries = await listChapters(document);

  if (chapterId === undefined) {
    return entries;
  }

  const selectedIds = await collectChapterSubtreeIds(document, chapterId);

  if (selectedIds.size === 0) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  return entries.filter((entry) => selectedIds.has(entry.chapterId));
}

async function collectChapterSubtreeIds(
  document: Document,
  chapterId: number,
): Promise<ReadonlySet<number>> {
  const toc = await normalizeChapterToc(document);
  const selectedIds = new Set<number>();

  for (const item of toc.items) {
    if (collectChapterSubtreeIdsFromItem(item, chapterId, selectedIds)) {
      break;
    }
  }

  return selectedIds;
}

function collectChapterSubtreeIdsFromItem(
  item: TocItem,
  chapterId: number,
  selectedIds: Set<number>,
): boolean {
  if (item.serialId === chapterId) {
    collectChapterIds(item, selectedIds);
    return true;
  }

  for (const child of item.children) {
    if (collectChapterSubtreeIdsFromItem(child, chapterId, selectedIds)) {
      return true;
    }
  }

  return false;
}

function isStageBefore(
  stage: ChapterStage,
  targetStage: ChapterStage,
): boolean {
  return CHAPTER_STAGES.indexOf(stage) < CHAPTER_STAGES.indexOf(targetStage);
}

async function resolveChapterStage(
  document: Document,
  chapterId: number,
  fragmentCount: number,
): Promise<ChapterStage> {
  const summary = await document.readSummary(chapterId);

  if (summary !== undefined) {
    return "summarized";
  }

  const serial = await document.serials.getById(chapterId);

  if (serial?.topologyReady === true) {
    return "graphed";
  }

  if (fragmentCount > 0) {
    return "sourced";
  }

  return "planned";
}

async function requireChapterDetails(
  document: Document,
  chapterId: number,
): Promise<ChapterDetails> {
  return await getChapterDetails(document, chapterId);
}

function appendChildToChapter(
  items: MutableTocItem[],
  parentChapterId: number,
  child: MutableTocItem,
): boolean {
  for (const item of items) {
    if (item.serialId === parentChapterId) {
      item.children = [...item.children, child];
      return true;
    }

    if (appendChildToChapter(item.children, parentChapterId, child)) {
      return true;
    }
  }

  return false;
}

function cloneTocItem(item: TocItem): MutableTocItem {
  return {
    children: item.children.map(cloneTocItem),
    ...(item.serialId === undefined ? {} : { serialId: item.serialId }),
    title: item.title,
  };
}

function createTopologyOptions(
  options: GenerateChapterGraphOptions,
): BuildSerialTopologyOptions {
  return {
    extractionPrompt: options.extractionPrompt,
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  };
}

async function* readChapterSource(
  document: Document,
  chapterId: number,
): ReaderTextStream {
  const fragments = document.getSerialFragments(chapterId);

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (const sentence of fragment.sentences) {
      yield sentence.text;
    }
  }
}

function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function removeChapterFromItems(
  items: readonly MutableTocItem[],
  chapterId: number,
  options: {
    readonly recursive: boolean;
    readonly removedChapterIds: number[];
  },
): { readonly items: MutableTocItem[]; readonly removed: boolean } {
  const nextItems: MutableTocItem[] = [];
  let removed = false;

  for (const item of items) {
    if (item.serialId === chapterId) {
      if (!options.recursive && item.children.length > 0) {
        throw new Error(
          `Chapter ${chapterId} has child chapters. Use --recursive to remove it and its descendants.`,
        );
      }

      collectChapterIds(item, options.removedChapterIds);
      removed = true;
      continue;
    }

    const childResult = removeChapterFromItems(
      item.children,
      chapterId,
      options,
    );

    nextItems.push({
      ...item,
      children: childResult.items,
    });
    removed ||= childResult.removed;
  }

  return {
    items: nextItems,
    removed,
  };
}

function collectChapterIds(
  item: TocItem,
  chapterIds: number[] | Set<number>,
): void {
  if (item.serialId !== undefined) {
    if (Array.isArray(chapterIds)) {
      chapterIds.push(item.serialId);
    } else {
      chapterIds.add(item.serialId);
    }
  }

  for (const child of item.children) {
    collectChapterIds(child, chapterIds);
  }
}

interface MutableTocFile {
  items: MutableTocItem[];
  version: typeof TOC_FILE_VERSION;
}

interface MutableTocItem {
  children: MutableTocItem[];
  serialId?: number | undefined;
  title?: string | null | undefined;
}
