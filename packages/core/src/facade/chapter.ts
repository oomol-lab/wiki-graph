import type { Document, ReadonlyDocument } from "../document/index.js";
import { normalizeLanguageCode, type Language } from "../common/language.js";
import type { WikiGraphScope } from "../common/llm-scope.js";
import type { LLM } from "../llm/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import { z } from "zod";
import {
  SerialGeneration,
  writeSerialSource,
  type SerialProgressSink,
  type BuildSerialTopologyOptions,
} from "../serial.js";
import type { TocItem } from "../source/index.js";
import { resolveExtractionPrompt } from "./prompts.js";
export { CHAPTER_STAGES } from "./chapter/types.js";
import { CHAPTER_STAGES } from "./chapter/types.js";
export type {
  AddChapterOptions,
  AdvanceChapterStagesOptions,
  AdvanceChapterStagesProgressCallback,
  AdvanceChapterStagesProgressEvent,
  AdvanceChapterStagesResult,
  ChapterDetails,
  ChapterEntry,
  ChapterStage,
  ChapterTree,
  ChapterTreeApplyResult,
  ChapterTreeInput,
  ChapterTreeInputNode,
  ChapterTreeMoveChange,
  ChapterTreeNode,
  ChapterTreeTitleChange,
  MoveChapterOptions,
  MutableAdvanceProgressState,
} from "./chapter/types.js";
import {
  collectChapterEntries,
  findChapterEntry,
  normalizeChapterToc,
  readChapterToc,
} from "./chapter/entries.js";
import {
  appendChildToChapter,
  cloneTocItem,
  collectChapterIds,
  collectTocItemMetas,
  createChapterTreeApplyResult,
  createTocItemsFromChapterTree,
  extractChapterItem,
  findChapterLocation,
  insertMovedChapter,
  normalizeTitle,
  rejectMoveIntoOwnSubtree,
  removeChapterFromItems,
  setChapterTitleInItems,
  toChapterTreeNodes,
} from "./chapter/tree.js";
import type {
  AddChapterOptions,
  AdvanceChapterStagesOptions,
  AdvanceChapterStagesProgressEvent,
  AdvanceChapterStagesResult,
  ChapterDetails,
  ChapterEntry,
  ChapterStage,
  ChapterTree,
  ChapterTreeApplyResult,
  ChapterTreeInput,
  ChapterTreeInputNode,
  MoveChapterOptions,
  MutableAdvanceProgressState,
} from "./chapter/types.js";
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
  readonly extractionPrompt?: string;
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly progressTracker?: SerialProgressSink;
  readonly userLanguage?: Language;
}

export interface GenerateChapterSummaryOptions {
  readonly llm: LLM<WikiGraphScope>;
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
        `Chapter ${options.parentChapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
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
    await openedDocument.clearSerialGraph(chapterId);

    await generation.buildTopologyInto(
      chapterId,
      createTopologyOptions(options),
      options.progressTracker,
    );
    const language = normalizeLanguageCode(options.userLanguage);
    const parameter = await openedDocument.graphBuildParameters.save({
      prompt: resolveExtractionPrompt(options.extractionPrompt),
      ...(language === undefined ? {} : { language }),
    });
    await openedDocument.serials.setTopologyReady(
      chapterId,
      true,
      parameter.hash,
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
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterDetails> {
  const toc = await readChapterToc(document);
  const entry = await findChapterEntry(document, toc.items, chapterId);

  if (entry === undefined) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
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
  document: ReadonlyDocument,
): Promise<readonly ChapterEntry[]> {
  const toc = await readChapterToc(document);

  return await collectChapterEntries(document, toc.items);
}

export async function getChapterTree(
  document: ReadonlyDocument,
): Promise<ChapterTree> {
  const toc = await readChapterToc(document);

  return {
    chapters: toc.items.flatMap(toChapterTreeNodes),
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
        `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
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
        `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
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
        `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
      );
    }

    await openedDocument.replaceToc(toc);
    return await getChapterDetails(openedDocument, chapterId);
  });
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
      extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
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
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<readonly ChapterEntry[]> {
  const entries = await listChapters(document);

  if (chapterId === undefined) {
    return entries;
  }

  const selectedIds = await collectChapterSubtreeIds(document, chapterId);

  if (selectedIds.size === 0) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
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
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ReadonlySet<number>> {
  const toc = await readChapterToc(document);
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

async function requireChapterDetails(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterDetails> {
  return await getChapterDetails(document, chapterId);
}

function createTopologyOptions(
  options: GenerateChapterGraphOptions,
): BuildSerialTopologyOptions {
  return {
    extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  };
}
