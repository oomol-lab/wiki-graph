import type { Document } from "../document/index.js";
import type { Language } from "../common/language.js";
import type { SpineDigestScope } from "../common/llm-scope.js";
import type { LLM } from "../llm/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import { z } from "zod";
import {
  SerialGeneration,
  writeSerialSource,
  type SerialProgressSink,
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
  readonly words: number;
}

export interface ChapterDetails extends ChapterEntry {
  readonly graphReady: boolean;
  readonly hasSummary: boolean;
  readonly words: number;
}

export interface ChapterTree {
  readonly chapters: readonly ChapterTreeNode[];
}

export interface ChapterTreeNode {
  readonly children: readonly ChapterTreeNode[];
  readonly id: number;
  readonly title: string | null;
}

export interface ChapterTreeInput {
  readonly chapters: readonly ChapterTreeInputNode[];
}

export interface ChapterTreeInputNode {
  readonly children: readonly ChapterTreeInputNode[];
  readonly id: number;
  readonly title?: string | null | undefined;
}

export interface ChapterTreeApplyResult {
  readonly changed: boolean;
  readonly moved: readonly ChapterTreeMoveChange[];
  readonly renamed: readonly ChapterTreeTitleChange[];
  readonly unchanged: number;
}

export interface ChapterTreeMoveChange {
  readonly chapterId: number;
  readonly newIndex: number;
  readonly newParentChapterId: number | null;
  readonly newPath: readonly string[];
  readonly oldIndex: number;
  readonly oldParentChapterId: number | null;
  readonly oldPath: readonly string[];
}

export interface ChapterTreeTitleChange {
  readonly chapterId: number;
  readonly newTitle: string | null;
  readonly oldTitle: string | null;
}

export interface MoveChapterOptions {
  readonly afterChapterId?: number;
  readonly beforeChapterId?: number;
  readonly first?: boolean;
  readonly last?: boolean;
  readonly parentChapterId?: number;
  readonly root?: boolean;
}

export interface AdvanceChapterStagesOptions {
  readonly chapterId?: number;
  readonly extractionPrompt: string;
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly onProgress?: AdvanceChapterStagesProgressCallback;
  readonly targetStage: ChapterStage;
  readonly userLanguage?: Language;
}

export interface AdvanceChapterStagesProgressState {
  readonly graphWords: number;
  readonly summaryWords: number;
  readonly totalGraphWords: number;
  readonly totalSummaryWords: number;
}

export type AdvanceChapterStagesProgressCallback = (
  event: AdvanceChapterStagesProgressEvent,
) => void | Promise<void>;

export type AdvanceChapterStagesProgressEvent =
  | {
      readonly type: "selected";
      readonly state: AdvanceChapterStagesProgressState;
      readonly targetStage: ChapterStage;
      readonly totalChapters: number;
    }
  | {
      readonly type: "skipped";
      readonly chapter: ChapterEntry;
      readonly reason: "planned";
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "progress";
      readonly state: AdvanceChapterStagesProgressState;
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "started";
      readonly chapter: ChapterEntry;
      readonly step: "graph" | "summary";
      readonly targetStage: ChapterStage;
    }
  | {
      readonly type: "completed";
      readonly chapter: ChapterEntry;
      readonly step: "graph" | "summary";
      readonly targetStage: ChapterStage;
    };

export interface AdvanceChapterStagesResult {
  readonly advanced: readonly ChapterEntry[];
  readonly pending: readonly ChapterEntry[];
  readonly skipped: readonly ChapterEntry[];
}

interface MutableAdvanceProgressState {
  addGraphWords(words: number): void;
  addSummaryWords(words: number): void;
  snapshot(): AdvanceChapterStagesProgressState;
}

export interface AddChapterOptions {
  readonly parentChapterId?: number;
  readonly title?: string | null | undefined;
}

const chapterTreeInputNodeSchema: z.ZodType<ChapterTreeInputNode> = z
  .object({
    children: z.lazy(() => z.array(chapterTreeInputNodeSchema)),
    id: z.number().int().nonnegative(),
    title: z.string().nullable().optional(),
  })
  .strict();

const chapterTreeInputSchema: z.ZodType<ChapterTreeInput> = z
  .object({
    chapters: z.array(chapterTreeInputNodeSchema),
  })
  .strict();

export function parseChapterTreeInput(input: unknown): ChapterTreeInput {
  return chapterTreeInputSchema.parse(input);
}

export interface GenerateChapterGraphOptions {
  readonly extractionPrompt: string;
  readonly llm: LLM<SpineDigestScope>;
  readonly logDirPath?: string;
  readonly progressTracker?: SerialProgressSink;
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
  const progressState = createAdvanceProgressState(
    entries,
    options.targetStage,
  );
  await emitAdvanceProgress(options, {
    state: progressState.snapshot(),
    targetStage: options.targetStage,
    totalChapters: entries.length,
    type: "selected",
  });
  await emitPlannedSkips(entries, options);

  if (isStageBefore("sourced", options.targetStage)) {
    await advanceEntriesToGraphed(document, entries, options, {
      advancedIds,
      progressState,
    });
  }
  if (isStageBefore("graphed", options.targetStage)) {
    const graphedEntries = await selectChapterEntries(
      document,
      options.chapterId,
    );

    await advanceEntriesToSummarized(document, graphedEntries, options, {
      advancedIds,
      progressState,
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
      throw new Error(
        `Chapter ${options.parentChapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
      );
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
    const sourceText = await collectReaderText(
      readChapterSource(openedDocument, chapterId),
    );

    await openedDocument.clearSerialSource(chapterId);

    await generation.buildTopologyInto(
      chapterId,
      sourceText,
      createTopologyOptions(options),
      options.progressTracker,
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
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
    );
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

export async function getChapterTree(document: Document): Promise<ChapterTree> {
  const toc = await normalizeChapterToc(document);

  return {
    chapters: toc.items.map(toChapterTreeNode),
  };
}

export async function applyChapterTree(
  document: Document,
  tree: ChapterTreeInput,
  options: { readonly dryRun?: boolean } = {},
): Promise<ChapterTreeApplyResult> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const oldItems = toc.items.map(cloneTocItem);
    const oldMetas = collectTocItemMetas(oldItems);
    const { items } = createTocItemsFromChapterTree(tree, oldItems);
    const newMetas = collectTocItemMetas(items);
    const result = createChapterTreeApplyResult(oldMetas, newMetas);

    if (options.dryRun !== true && result.changed) {
      await openedDocument.replaceToc({
        items,
        version: toc.version,
      });
    }

    return result;
  });
}

export async function moveChapter(
  document: Document,
  chapterId: number,
  options: MoveChapterOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const originalLocation = findChapterLocation(toc.items, chapterId);
    const extracted = extractChapterItem(toc.items, chapterId);

    if (extracted.item === undefined) {
      throw new Error(
        `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
      );
    }

    rejectMoveIntoOwnSubtree(chapterId, extracted.item, options);

    toc.items = extracted.items;
    insertMovedChapter(toc.items, extracted.item, {
      originalParentChapterId: originalLocation?.parentChapterId,
      ...options,
    });
    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
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
      throw new Error(
        `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
      );
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

export async function setChapterTitle(
  document: Document,
  chapterId: number,
  title: string | null | undefined,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const toc = await normalizeChapterToc(openedDocument);
    const normalizedTitle = normalizeTitle(title);

    if (!setChapterTitleInItems(toc.items, chapterId, normalizedTitle)) {
      throw new Error(
        `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
      );
    }

    await openedDocument.replaceToc(toc);
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
    const serialFragments = document.getSerialFragments(item.serialId);
    const fragmentIds = await serialFragments.listFragmentIds();
    const fragmentCount = fragmentIds.length;
    let words = 0;

    for (const fragmentId of fragmentIds) {
      const fragment = await serialFragments.getFragment(fragmentId);

      words += fragment.sentences.reduce(
        (total, sentence) => total + sentence.wordsCount,
        0,
      );
    }

    entries.push({
      chapterId: item.serialId,
      childCount: item.children.length,
      depth,
      fragmentCount,
      stage: await resolveChapterStage(document, item.serialId, fragmentCount),
      title,
      tocPath,
      words,
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
  state: {
    readonly advancedIds: Set<number>;
    readonly progressState: MutableAdvanceProgressState;
  },
): Promise<readonly ChapterEntry[]> {
  for (const entry of entries) {
    if (entry.stage !== "sourced") {
      continue;
    }

    await emitAdvanceProgress(options, {
      chapter: entry,
      step: "graph",
      targetStage: options.targetStage,
      type: "started",
    });
    await generateChapterGraph(document, entry.chapterId, {
      extractionPrompt: options.extractionPrompt,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
      progressTracker: {
        async advance(wordsCount) {
          state.progressState.addGraphWords(wordsCount);
          await emitAdvanceProgress(options, {
            state: state.progressState.snapshot(),
            targetStage: options.targetStage,
            type: "progress",
          });
        },
        async complete() {},
      },
    });
    await emitAdvanceProgress(options, {
      chapter: entry,
      step: "graph",
      targetStage: options.targetStage,
      type: "completed",
    });
    state.advancedIds.add(entry.chapterId);
  }

  return await selectChapterEntries(document, options.chapterId);
}

async function advanceEntriesToSummarized(
  document: Document,
  entries: readonly ChapterEntry[],
  options: AdvanceChapterStagesOptions,
  state: {
    readonly advancedIds: Set<number>;
    readonly progressState: MutableAdvanceProgressState;
  },
): Promise<readonly ChapterEntry[]> {
  for (const entry of entries) {
    if (entry.stage !== "graphed") {
      continue;
    }

    await emitAdvanceProgress(options, {
      chapter: entry,
      step: "summary",
      targetStage: options.targetStage,
      type: "started",
    });
    await generateChapterSummary(document, entry.chapterId, {
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });
    state.progressState.addSummaryWords(entry.words);
    await emitAdvanceProgress(options, {
      state: state.progressState.snapshot(),
      targetStage: options.targetStage,
      type: "progress",
    });
    await emitAdvanceProgress(options, {
      chapter: entry,
      step: "summary",
      targetStage: options.targetStage,
      type: "completed",
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
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
    );
  }

  return entries.filter((entry) => selectedIds.has(entry.chapterId));
}

function createAdvanceProgressState(
  entries: readonly ChapterEntry[],
  targetStage: ChapterStage,
): MutableAdvanceProgressState {
  const totalGraphWords = isStageBefore("sourced", targetStage)
    ? entries
        .filter((entry) => entry.stage === "sourced")
        .reduce((sum, entry) => sum + entry.words, 0)
    : 0;
  const totalSummaryWords = isStageBefore("graphed", targetStage)
    ? entries
        .filter(
          (entry) => entry.stage === "graphed" || entry.stage === "sourced",
        )
        .reduce((sum, entry) => sum + entry.words, 0)
    : 0;
  let graphWords = 0;
  let summaryWords = 0;

  return {
    addGraphWords(words) {
      graphWords = Math.min(totalGraphWords, graphWords + Math.max(0, words));
    },
    addSummaryWords(words) {
      summaryWords = Math.min(
        totalSummaryWords,
        summaryWords + Math.max(0, words),
      );
    },
    snapshot() {
      return {
        graphWords,
        summaryWords,
        totalGraphWords,
        totalSummaryWords,
      };
    },
  };
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

async function emitPlannedSkips(
  entries: readonly ChapterEntry[],
  options: AdvanceChapterStagesOptions,
): Promise<void> {
  for (const entry of entries) {
    if (entry.stage !== "planned") {
      continue;
    }

    await emitAdvanceProgress(options, {
      chapter: entry,
      reason: "planned",
      targetStage: options.targetStage,
      type: "skipped",
    });
  }
}

async function emitAdvanceProgress(
  options: AdvanceChapterStagesOptions,
  event: AdvanceChapterStagesProgressEvent,
): Promise<void> {
  try {
    await options.onProgress?.(event);
  } catch {
    return;
  }
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

function createChapterTreeApplyResult(
  oldMetas: Map<number, TocItemMeta>,
  newMetas: Map<number, TocItemMeta>,
): ChapterTreeApplyResult {
  const moved: ChapterTreeMoveChange[] = [];
  const renamed: ChapterTreeTitleChange[] = [];
  let unchanged = 0;

  for (const [chapterId, oldMeta] of oldMetas) {
    const newMeta = newMetas.get(chapterId);

    if (newMeta === undefined) {
      continue;
    }

    const movedChapter =
      oldMeta.parentChapterId !== newMeta.parentChapterId ||
      oldMeta.index !== newMeta.index;
    const renamedChapter = oldMeta.title !== newMeta.title;

    if (movedChapter) {
      moved.push({
        chapterId,
        newIndex: newMeta.index,
        newParentChapterId: newMeta.parentChapterId,
        newPath: newMeta.path,
        oldIndex: oldMeta.index,
        oldParentChapterId: oldMeta.parentChapterId,
        oldPath: oldMeta.path,
      });
    }
    if (renamedChapter) {
      renamed.push({
        chapterId,
        newTitle: newMeta.title,
        oldTitle: oldMeta.title,
      });
    }
    if (!movedChapter && !renamedChapter) {
      unchanged += 1;
    }
  }

  return {
    changed: moved.length > 0 || renamed.length > 0,
    moved,
    renamed,
    unchanged,
  };
}

function createTocItemsFromChapterTree(
  tree: ChapterTreeInput,
  oldItems: readonly MutableTocItem[],
): { readonly items: MutableTocItem[] } {
  const oldItemsById = new Map<number, MutableTocItem>();
  const oldIds = new Set<number>();

  for (const oldItem of oldItems) {
    collectTocItemsById(oldItem, oldItemsById, oldIds);
  }

  const seenIds = new Set<number>();
  const items = tree.chapters.map((node) =>
    createTocItemFromChapterTreeNode(node, oldItemsById, seenIds),
  );
  const missingIds = [...oldIds].filter((id) => !seenIds.has(id));

  if (missingIds.length > 0) {
    throw new Error(
      `Chapter tree is missing chapter ids: ${missingIds.join(", ")}.`,
    );
  }

  return { items };
}

function createTocItemFromChapterTreeNode(
  node: ChapterTreeInputNode,
  oldItemsById: Map<number, MutableTocItem>,
  seenIds: Set<number>,
): MutableTocItem {
  const oldItem = oldItemsById.get(node.id);

  if (oldItem === undefined) {
    throw new Error(`Chapter tree references unknown chapter id: ${node.id}.`);
  }
  if (seenIds.has(node.id)) {
    throw new Error(`Chapter tree repeats chapter id: ${node.id}.`);
  }
  seenIds.add(node.id);

  const title = Object.prototype.hasOwnProperty.call(node, "title")
    ? normalizeTitle(node.title)
    : normalizeTitle(oldItem.title);
  const item: MutableTocItem = {
    children: node.children.map((child) =>
      createTocItemFromChapterTreeNode(child, oldItemsById, seenIds),
    ),
    serialId: node.id,
  };

  if (title !== undefined) {
    item.title = title;
  }

  return item;
}

function collectTocItemsById(
  item: MutableTocItem,
  itemsById: Map<number, MutableTocItem>,
  ids: Set<number>,
): void {
  if (item.serialId !== undefined) {
    itemsById.set(item.serialId, item);
    ids.add(item.serialId);
  }

  for (const child of item.children) {
    collectTocItemsById(child, itemsById, ids);
  }
}

function collectTocItemMetas(
  items: readonly MutableTocItem[],
  parentChapterId: number | null = null,
  parentPath: readonly string[] = [],
): Map<number, TocItemMeta> {
  const metas = new Map<number, TocItemMeta>();

  items.forEach((item, index) => {
    if (item.serialId === undefined) {
      return;
    }

    const title = normalizeTitle(item.title) ?? null;
    const path = [...parentPath, title ?? `Chapter ${item.serialId}`];

    metas.set(item.serialId, {
      index,
      parentChapterId,
      path,
      title,
    });

    for (const [childId, childMeta] of collectTocItemMetas(
      item.children,
      item.serialId,
      path,
    )) {
      metas.set(childId, childMeta);
    }
  });

  return metas;
}

function extractChapterItem(
  items: readonly MutableTocItem[],
  chapterId: number,
): {
  readonly item?: MutableTocItem;
  readonly items: MutableTocItem[];
} {
  const nextItems: MutableTocItem[] = [];

  for (const item of items) {
    if (item.serialId === chapterId) {
      return {
        item,
        items: [...nextItems, ...items.slice(nextItems.length + 1)],
      };
    }

    const childResult = extractChapterItem(item.children, chapterId);

    if (childResult.item !== undefined) {
      nextItems.push({
        ...item,
        children: childResult.items,
      });
      nextItems.push(...items.slice(nextItems.length));
      return {
        item: childResult.item,
        items: nextItems,
      };
    }

    nextItems.push(item);
  }

  return {
    items: [...items],
  };
}

function findChildContainer(
  items: MutableTocItem[],
  parentChapterId: number | undefined,
): MutableTocItem[] | undefined {
  if (parentChapterId === undefined) {
    return items;
  }

  for (const item of items) {
    if (item.serialId === parentChapterId) {
      return item.children;
    }

    const childContainer = findChildContainer(item.children, parentChapterId);

    if (childContainer !== undefined) {
      return childContainer;
    }
  }

  return undefined;
}

function findChapterLocation(
  items: MutableTocItem[],
  chapterId: number,
):
  | {
      readonly index: number;
      readonly parentChapterId?: number | undefined;
      readonly siblings: MutableTocItem[];
    }
  | undefined {
  return findChapterLocationInItems(items, chapterId);
}

function findChapterLocationInItems(
  items: MutableTocItem[],
  chapterId: number,
  parentChapterId?: number,
):
  | {
      readonly index: number;
      readonly parentChapterId?: number | undefined;
      readonly siblings: MutableTocItem[];
    }
  | undefined {
  for (const [index, item] of items.entries()) {
    if (item.serialId === chapterId) {
      return {
        index,
        parentChapterId,
        siblings: items,
      };
    }

    const location = findChapterLocationInItems(
      item.children,
      chapterId,
      item.serialId,
    );

    if (location !== undefined) {
      return location;
    }
  }

  return undefined;
}

function insertMovedChapter(
  items: MutableTocItem[],
  item: MutableTocItem,
  options: MoveChapterOptions & {
    readonly originalParentChapterId?: number | undefined;
  },
): void {
  if (
    options.beforeChapterId !== undefined ||
    options.afterChapterId !== undefined
  ) {
    const targetChapterId = options.beforeChapterId ?? options.afterChapterId!;
    const location = findChapterLocation(items, targetChapterId);

    if (location === undefined) {
      throw new Error(`Target chapter ${targetChapterId} does not exist.`);
    }

    location.siblings.splice(
      options.beforeChapterId === undefined
        ? location.index + 1
        : location.index,
      0,
      item,
    );
    return;
  }

  const parentChapterId =
    options.root === true
      ? undefined
      : options.parentChapterId !== undefined
        ? options.parentChapterId
        : options.originalParentChapterId;
  const container = findChildContainer(items, parentChapterId);

  if (container === undefined) {
    throw new Error(`Chapter ${parentChapterId} does not exist.`);
  }

  if (options.first === true) {
    container.splice(0, 0, item);
  } else {
    container.push(item);
  }
}

function rejectMoveIntoOwnSubtree(
  chapterId: number,
  item: MutableTocItem,
  options: MoveChapterOptions,
): void {
  const targetIds = [
    options.parentChapterId,
    options.beforeChapterId,
    options.afterChapterId,
  ].filter((id): id is number => id !== undefined);

  for (const targetId of targetIds) {
    if (targetId === chapterId || containsChapterId(item.children, targetId)) {
      throw new Error(
        `Cannot move chapter ${chapterId} into or next to its own descendant ${targetId}.`,
      );
    }
  }
}

function containsChapterId(
  items: readonly MutableTocItem[],
  chapterId: number,
): boolean {
  for (const item of items) {
    if (
      item.serialId === chapterId ||
      containsChapterId(item.children, chapterId)
    ) {
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

function toChapterTreeNode(item: MutableTocItem): ChapterTreeNode {
  if (item.serialId === undefined) {
    throw new Error("Internal error: normalized chapter tree has no id.");
  }

  return {
    children: item.children.map(toChapterTreeNode),
    id: item.serialId,
    title: normalizeTitle(item.title) ?? null,
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

async function collectReaderText(
  stream: ReaderTextStream,
): Promise<readonly string[]> {
  const text: string[] = [];

  for await (const chunk of stream) {
    text.push(chunk);
  }

  return text;
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

function setChapterTitleInItems(
  items: readonly MutableTocItem[],
  chapterId: number,
  title: string | undefined,
): boolean {
  for (const item of items) {
    if (item.serialId === chapterId) {
      if (title === undefined) {
        delete item.title;
      } else {
        item.title = title;
      }
      return true;
    }

    if (setChapterTitleInItems(item.children, chapterId, title)) {
      return true;
    }
  }

  return false;
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

interface TocItemMeta {
  readonly index: number;
  readonly parentChapterId: number | null;
  readonly path: readonly string[];
  readonly title: string | null;
}
