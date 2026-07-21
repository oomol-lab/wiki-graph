import type { Document } from "../../document/index.js";
import { resolveExtractionPrompt } from "../../runtime/common/prompts.js";
import { isStageBefore, selectChapterEntries } from "./details.js";
import { generateChapterGraph, generateChapterSummary } from "./generate.js";
import type {
  AdvanceChapterStagesOptions,
  AdvanceChapterStagesProgressEvent,
  AdvanceChapterStagesResult,
  ChapterEntry,
  ChapterStage,
  MutableAdvanceProgressState,
} from "./types.js";

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
