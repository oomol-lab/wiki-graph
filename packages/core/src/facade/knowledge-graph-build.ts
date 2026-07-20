import { createReadStream, createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { z } from "zod";

import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "../guaranteed/index.js";
import type {
  Document,
  FragmentRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
  SentenceId,
} from "../document/index.js";
import { LanguageCode, normalizeLanguageCode } from "../common/language.js";
import type { WikipageResolveProgress } from "../wikipage/index.js";
import {
  buildWikimatchSurfaceProtectionInput,
  buildWikimatchWindows,
  enrichWikimatchCandidates,
  filterCandidateQidOptions,
  judgeWikimatchPolicy,
  judgeWikimatchSurfaceProtection,
  listCandidateSelectableQids,
  matchWikispineSentenceCandidates,
  type WikimatchAcceptedMention,
  type WikimatchCandidate,
  type WikimatchSentence,
  type MatchWikispineSentenceCandidatesOptions,
} from "../wikimatch/index.js";
import type { WikipageResolverOptions } from "../wikipage/index.js";
import {
  buildWikilinkEvidenceWindows,
  discoverWikilinkRelations,
  type WikilinkEvidenceWindow,
  type WikilinkMention,
  type WikilinkSentence,
} from "../wikilink/index.js";

import { getChapterDetails, type ChapterDetails } from "./chapter.js";
import type { BuildJobProgressReporter } from "./build-queue.js";
import { resolveKnowledgeGraphRecallPrompt } from "./prompts.js";

export interface ChapterKnowledgeGraphBuildArtifact {
  readonly chapterId: number;
  readonly mentionLinksPath: string;
  readonly mentionsPath: string;
  readonly parameter: GraphBuildParameterInput;
  readonly workspacePath: string;
}

export interface ChapterKnowledgeGraphInputSnapshot {
  readonly details: ChapterDetails;
  readonly fragments: readonly FragmentRecord[];
}

export interface GraphBuildParameterInput {
  readonly language?: string;
  readonly prompt: string;
}

export interface BuildChapterKnowledgeGraphArtifactOptions {
  readonly mentionLinks:
    | AsyncIterable<MentionLinkRecord>
    | Iterable<MentionLinkRecord>;
  readonly mentions: AsyncIterable<MentionRecord> | Iterable<MentionRecord>;
  readonly parameter?: GraphBuildParameterInput;
  readonly workspacePath: string;
}

export interface GenerateChapterKnowledgeGraphArtifactOptions {
  readonly policyPrompt?: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly resolverOptions?: Omit<WikipageResolverOptions, "progress">;
  readonly wikispine?: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "command" | "dataDir" | "endpoint" | "provider"
  >;
  readonly workspacePath: string;
}

const mentionRecordSchema = z.object({
  id: z.string().min(1),
  chapterId: z.number().int(),
  sentenceIndex: z.number().int().nonnegative().optional(),
  rangeStart: z.number().int().nonnegative(),
  rangeEnd: z.number().int().nonnegative(),
  surface: z.string().min(1),
  qid: z.string().regex(/^Q[1-9][0-9]*$/),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

const sentenceIdSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .readonly();

const mentionLinkRecordSchema = z.object({
  id: z.string().min(1),
  sourceMentionId: z.string().min(1),
  targetMentionId: z.string().min(1),
  predicate: z.string().min(1),
  evidenceSentenceIds: z.array(sentenceIdSchema).min(1),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

const WIKIMATCH_GROUNDING_DEFAULT_OPTION_BUDGETS = [5, 10, 20, 35] as const;
const WIKIMATCH_GROUNDING_PRIOR_OPTION_BUDGETS = [3, 5, 10, 20, 35] as const;
const WIKIMATCH_GROUNDING_MAX_OPTION_BUDGET = 50;
const WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD = 3;
const WIKIMATCH_SURFACE_PROTECTION_PERCENTILE = 0.1;
const WIKILINK_EVIDENCE_DISTANCE = 700;
const WIKILINK_WINDOW_LENGTH = 1800;

export async function generateChapterKnowledgeGraphArtifact(
  document: ReadonlyDocument,
  chapterId: number,
  options: GenerateChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  return await generateChapterKnowledgeGraphArtifactFromSnapshot(
    chapterId,
    await snapshotChapterKnowledgeGraphInput(document, chapterId),
    options,
  );
}

export async function snapshotChapterKnowledgeGraphInput(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterKnowledgeGraphInputSnapshot> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage === "planned") {
    throw new Error(
      `Chapter ${chapterId} is planned. Set source before generating Knowledge Graph.`,
    );
  }

  return {
    details,
    fragments: await readChapterFragments(document, chapterId),
  };
}

export async function generateChapterKnowledgeGraphArtifactFromSnapshot(
  chapterId: number,
  snapshot: ChapterKnowledgeGraphInputSnapshot,
  options: GenerateChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  if (snapshot.details.chapterId !== chapterId) {
    throw new Error(
      `Knowledge Graph snapshot belongs to chapter ${snapshot.details.chapterId}, not chapter ${chapterId}.`,
    );
  }
  if (snapshot.details.stage === "planned") {
    throw new Error(
      `Chapter ${chapterId} is planned. Set source before generating Knowledge Graph.`,
    );
  }

  const fragments = snapshot.fragments;
  const text = joinFragmentText(fragments);
  const sentences = createWikimatchSentences(fragments);
  const policyPrompt = resolveKnowledgeGraphRecallPrompt(options.policyPrompt);
  await options.progressTracker?.updatePhase({
    done: 0,
    phase: "matching",
    phaseDetail: "text",
    total: text.length,
    unit: "char",
  });
  const rawCandidates = await matchWikispineSentenceCandidates({
    includeDisambiguation: true,
    onProgress: async (progress) => {
      await options.progressTracker?.updatePhase({
        done: progress.coveredRangeEnd,
        force: false,
        phase: "matching",
        phaseDetail: "text",
        total: text.length,
        unit: "char",
      });
    },
    ...(options.wikispine ?? {}),
    sentences,
  });
  await options.progressTracker?.throwIfStopped();
  await options.progressTracker?.updatePhase({
    done: text.length,
    phase: "matching",
    phaseDetail: "text",
    total: text.length,
    unit: "char",
  });
  const screenedCandidates = await screenCandidates({
    candidates: rawCandidates,
    policyPrompt,
    ...(options.progressTracker === undefined
      ? {}
      : { progressTracker: options.progressTracker }),
    request: options.request,
    text,
  });
  await options.progressTracker?.throwIfStopped();
  const qidCount = countUniqueQids(screenedCandidates);
  await options.progressTracker?.updatePhase({
    done: 0,
    phase: "enrichment",
    total: qidCount,
    unit: "qid",
  });
  const enrichedCandidates = await enrichWikimatchCandidates(
    screenedCandidates,
    {
      ...(options.progressTracker === undefined
        ? {}
        : {
            progress: createEnrichmentProgressReporter(options.progressTracker),
          }),
      ...(options.resolverOptions === undefined
        ? {}
        : { resolverOptions: options.resolverOptions }),
    },
  );
  await options.progressTracker?.throwIfStopped();
  await options.progressTracker?.updatePhase({
    done: qidCount,
    phase: "enrichment",
    total: qidCount,
    unit: "qid",
  });
  const mentions = await judgeCandidates({
    candidates: enrichedCandidates,
    chapterId,
    fragments,
    policyPrompt,
    ...(options.progressTracker === undefined
      ? {}
      : { progressTracker: options.progressTracker }),
    request: options.request,
    text,
  });
  await options.progressTracker?.throwIfStopped();
  const mentionLinks = await discoverMentionLinks({
    fragments,
    mentions,
    ...(options.progressTracker === undefined
      ? {}
      : { progressTracker: options.progressTracker }),
    request: options.request,
  });
  await options.progressTracker?.throwIfStopped();
  const artifact = await buildChapterKnowledgeGraphArtifact(chapterId, {
    mentionLinks,
    mentions,
    parameter: createKnowledgeGraphParameterInput({
      policyPrompt,
      ...(options.resolverOptions === undefined
        ? {}
        : { resolverOptions: options.resolverOptions }),
    }),
    workspacePath: options.workspacePath,
  });

  return artifact;
}

export async function buildChapterKnowledgeGraphArtifact(
  chapterId: number,
  options: BuildChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  const workspacePath = join(
    options.workspacePath,
    "knowledge-graph",
    `chapter-${chapterId}`,
  );
  const mentionsPath = join(workspacePath, "mentions.jsonl");
  const mentionLinksPath = join(workspacePath, "mention-links.jsonl");

  await rm(workspacePath, { force: true, recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeJsonl(mentionsPath, options.mentions, parseMentionRecord);
  await writeJsonl(
    mentionLinksPath,
    options.mentionLinks,
    parseMentionLinkRecord,
  );

  return {
    chapterId,
    mentionLinksPath,
    mentionsPath,
    parameter: options.parameter ?? {
      language: LanguageCode.Chinese,
      prompt: "",
    },
    workspacePath,
  };
}

function createKnowledgeGraphParameterInput(
  options: Pick<
    GenerateChapterKnowledgeGraphArtifactOptions,
    "policyPrompt" | "resolverOptions"
  > & { readonly policyPrompt: string },
): GraphBuildParameterInput {
  return {
    language:
      normalizeLanguageCode(options.resolverOptions?.language) ??
      LanguageCode.Chinese,
    prompt: options.policyPrompt,
  };
}

async function screenCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly WikimatchCandidate[]> {
  if (input.candidates.length === 0) {
    return [];
  }

  const protectionInput = buildWikimatchSurfaceProtectionInput({
    candidates: input.candidates,
    percentile: WIKIMATCH_SURFACE_PROTECTION_PERCENTILE,
    text: input.text,
  });

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "screening",
    phaseDetail: `${protectionInput.suspiciousSurfaces.length} high-frequency surfaces`,
    total: 1,
    unit: "window",
  });
  await input.progressTracker?.throwIfStopped();
  const protection = await judgeWikimatchSurfaceProtection({
    policyPrompt: input.policyPrompt,
    request: input.request,
    suspiciousSurfaces: protectionInput.suspiciousSurfaces,
  });
  await input.progressTracker?.throwIfStopped();
  const protectedSurfaces = new Set(
    protection.protectedSurfaces.map((surface) => surface.text),
  );
  const allowedCandidateKeys = new Set(
    protectionInput.candidates.map(createCandidateRangeKey),
  );

  await input.progressTracker?.updatePhase({
    done: 1,
    phase: "screening",
    phaseDetail: `${protectedSurfaces.size} protected surfaces`,
    total: 1,
    unit: "window",
  });

  return protectionInput.suppressedCandidates.filter(
    (candidate) =>
      allowedCandidateKeys.has(createCandidateRangeKey(candidate)) ||
      protectedSurfaces.has(candidate.surface),
  );
}

function createCandidateRangeKey(candidate: WikimatchCandidate): string {
  return `${candidate.range.start}\0${candidate.range.end}\0${candidate.surface}`;
}

async function judgeCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly chapterId: number;
  readonly fragments: readonly FragmentRecord[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly MentionRecord[]> {
  const mentions: MentionRecord[] = [];
  const sentenceLocations = buildSentenceLocations(input.fragments);
  const acceptedMentions = await groundWikimatchCandidates({
    candidates: input.candidates,
    policyPrompt: input.policyPrompt,
    ...(input.progressTracker === undefined
      ? {}
      : { progressTracker: input.progressTracker }),
    request: input.request,
    text: input.text,
  });
  let mentionIndex = 1;

  for (const mention of acceptedMentions) {
    const location = locateMention(sentenceLocations, mention.range.start);

    mentions.push(
      toMentionRecord(input.chapterId, mention, location, mentionIndex),
    );
    mentionIndex += 1;
  }

  return mentions;
}

export async function groundWikimatchCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly WikimatchAcceptedMention[]> {
  const mentions: WikimatchAcceptedMention[] = [];
  const candidatePages = createGroundingCandidatePages(input.candidates);
  let completedWindows = 0;
  let totalWindows = 0;

  let activeCandidates = candidatePages.nextPage();

  while (activeCandidates.length > 0) {
    const windows = buildWikimatchWindows({
      candidates: activeCandidates,
      contextWords: 220,
      optionBudget: WIKIMATCH_GROUNDING_MAX_OPTION_BUDGET,
      text: input.text,
    });

    totalWindows += windows.length;
    if (windows.length === 0) {
      break;
    }
    await input.progressTracker?.updatePhase({
      done: completedWindows,
      phase: "grounding",
      total: totalWindows,
      unit: "window",
    });

    const results = await mapLazyGuaranteedRequests(
      input.request,
      windows,
      async (window, request) => {
        try {
          await input.progressTracker?.throwIfStopped();
          return await judgeWikimatchPolicy({
            candidates: window.candidates,
            policyPrompt: input.policyPrompt,
            request,
            window,
          });
        } finally {
          completedWindows += 1;
          await input.progressTracker?.updatePhase({
            done: completedWindows,
            phase: "grounding",
            total: totalWindows,
            unit: "window",
          });
        }
      },
    );

    const continuedCandidateIds = new Set<string>();

    for (const result of results) {
      for (const mention of result.mentions) {
        mentions.push(mention);
        candidatePages.accept(mention);
      }
      for (const update of result.policyUpdates) {
        candidatePages.close(update.candidateId, update.decision);
      }
      for (const continuation of result.continuations) {
        for (const candidateId of continuation.candidateIds) {
          continuedCandidateIds.add(candidateId);
          candidatePages.continue(candidateId);
        }
      }
    }

    activeCandidates = candidatePages.nextPage(continuedCandidateIds);
  }

  await input.progressTracker?.updatePhase({
    done: completedWindows,
    phase: "grounding",
    phaseDetail: formatGroundingEfficiency(
      candidatePages.getStats(),
      mentions.length,
    ),
    total: totalWindows,
    unit: "window",
  });

  return mentions;
}

function createGroundingCandidatePages(
  candidates: readonly WikimatchCandidate[],
): {
  readonly accept: (mention: WikimatchAcceptedMention) => void;
  readonly close: (
    candidateId: string,
    decision?: "skip_this_time" | "never_recall",
  ) => void;
  readonly continue: (candidateId: string) => void;
  readonly getStats: () => GroundingCandidatePageStats;
  readonly nextPage: (
    continuedCandidateIds?: ReadonlySet<string>,
  ) => readonly WikimatchCandidate[];
} {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const shownQidsByCandidateId = new Map(
    candidates.map((candidate) => [candidate.id, new Set<string>()]),
  );
  const pageIndexesByCandidateId = new Map(
    candidates.map((candidate) => [candidate.id, 0]),
  );
  const closedCandidateIds = new Set<string>();
  const recallCounts = new Map<string, number>();
  const surfaceStats = new Map<string, GroundingSurfaceStats>();
  const stats: GroundingCandidatePageStats = {
    candidatePageCount: 0,
    qidAppearanceCount: 0,
  };

  return {
    accept(mention) {
      closedCandidateIds.add(mention.candidateId);
      getSurfaceStats(surfaceStats, mention.surface).recallCount += 1;
      recallCounts.set(
        createSurfaceQidKey(mention.surface, mention.qid),
        (recallCounts.get(createSurfaceQidKey(mention.surface, mention.qid)) ??
          0) + 1,
      );
    },
    close(candidateId, decision) {
      closedCandidateIds.add(candidateId);
      const candidate = candidatesById.get(candidateId);

      if (
        candidate !== undefined &&
        (decision === "skip_this_time" || decision === "never_recall")
      ) {
        getSurfaceStats(surfaceStats, candidate.surface).rejectCount += 1;
      }
    },
    continue(candidateId) {
      const candidate = candidatesById.get(candidateId);

      if (candidate !== undefined) {
        getSurfaceStats(surfaceStats, candidate.surface).continueCount += 1;
      }
    },
    getStats() {
      return { ...stats };
    },
    nextPage(continuedCandidateIds) {
      const pageCandidates: WikimatchCandidate[] = [];
      const candidateIds =
        continuedCandidateIds === undefined
          ? candidates.map((candidate) => candidate.id)
          : [...continuedCandidateIds];

      for (const candidateId of candidateIds) {
        if (closedCandidateIds.has(candidateId)) {
          continue;
        }

        const candidate = candidatesById.get(candidateId);
        const shownQids = shownQidsByCandidateId.get(candidateId);

        if (candidate === undefined || shownQids === undefined) {
          continue;
        }

        const sortedCandidate = sortCandidateOptionsByRecall(
          candidate,
          recallCounts,
        );
        const selectableQids = listCandidateSelectableQids(sortedCandidate);
        const pageIndex = pageIndexesByCandidateId.get(candidateId) ?? 0;
        const optionBudget = getGroundingCandidateOptionBudget(
          getSurfaceStats(surfaceStats, candidate.surface),
          pageIndex,
        );
        const selectedQids = selectableQids
          .filter((qid) => !shownQids.has(qid))
          .slice(0, optionBudget);

        if (selectedQids.length === 0) {
          closedCandidateIds.add(candidateId);
          continue;
        }

        for (const qid of selectedQids) {
          shownQids.add(qid);
        }

        const hasMoreOptions = selectableQids.some(
          (qid) => !shownQids.has(qid),
        );
        const pageCandidate = filterCandidateQidOptions(
          sortedCandidate,
          new Set(selectedQids),
        );

        if (!hasMoreOptions) {
          closedCandidateIds.add(candidateId);
        }
        getSurfaceStats(surfaceStats, candidate.surface).seenCount += 1;
        pageIndexesByCandidateId.set(candidateId, pageIndex + 1);
        stats.candidatePageCount += 1;
        stats.qidAppearanceCount += selectedQids.length;
        pageCandidates.push({
          ...pageCandidate,
          ...(hasMoreOptions ? { hasMoreOptions: true } : {}),
        });
      }

      return pageCandidates;
    },
  };
}

interface GroundingSurfaceStats {
  continueCount: number;
  recallCount: number;
  rejectCount: number;
  seenCount: number;
}

interface GroundingCandidatePageStats {
  candidatePageCount: number;
  qidAppearanceCount: number;
}

function getSurfaceStats(
  surfaceStats: Map<string, GroundingSurfaceStats>,
  surface: string,
): GroundingSurfaceStats {
  const existing = surfaceStats.get(surface);

  if (existing !== undefined) {
    return existing;
  }

  const created = {
    continueCount: 0,
    recallCount: 0,
    rejectCount: 0,
    seenCount: 0,
  };
  surfaceStats.set(surface, created);

  return created;
}

function getGroundingCandidateOptionBudget(
  stats: GroundingSurfaceStats,
  pageIndex: number,
): number {
  const budgets = hasStrongGroundingSurfacePrior(stats)
    ? WIKIMATCH_GROUNDING_PRIOR_OPTION_BUDGETS
    : WIKIMATCH_GROUNDING_DEFAULT_OPTION_BUDGETS;

  return budgets[Math.min(pageIndex, budgets.length - 1)]!;
}

function hasStrongGroundingSurfacePrior(stats: GroundingSurfaceStats): boolean {
  if (stats.seenCount < WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD) {
    return false;
  }

  return (
    (stats.recallCount >= 2 && stats.continueCount === 0) ||
    (stats.rejectCount >= 2 && stats.recallCount === 0) ||
    stats.continueCount >= WIKIMATCH_GROUNDING_SURFACE_PRIOR_THRESHOLD
  );
}

function formatGroundingEfficiency(
  stats: GroundingCandidatePageStats,
  mentionCount: number,
): string {
  const qidPerMention =
    mentionCount === 0
      ? "n/a"
      : (stats.qidAppearanceCount / mentionCount).toFixed(1);

  return `efficiency qid/mention=${qidPerMention} qids=${stats.qidAppearanceCount} mentions=${mentionCount} pages=${stats.candidatePageCount}`;
}

function sortCandidateOptionsByRecall(
  candidate: WikimatchCandidate,
  recallCounts: ReadonlyMap<string, number>,
): WikimatchCandidate {
  return {
    ...candidate,
    qidOptions: [...candidate.qidOptions].sort((left, right) => {
      return (
        getOptionRecallScore(candidate.surface, right, recallCounts) -
        getOptionRecallScore(candidate.surface, left, recallCounts)
      );
    }),
  };
}

function getOptionRecallScore(
  surface: string,
  option: WikimatchCandidate["qidOptions"][number],
  recallCounts: ReadonlyMap<string, number>,
): number {
  const directScore =
    recallCounts.get(createSurfaceQidKey(surface, option.qid)) ?? 0;
  const disambiguationScore =
    option.disambiguation?.linkedQids.reduce(
      (total, item) =>
        total + (recallCounts.get(createSurfaceQidKey(surface, item.qid)) ?? 0),
      0,
    ) ?? 0;
  const profileScore =
    option.disambiguation?.profile?.meanings.reduce(
      (total, item) =>
        total + (recallCounts.get(createSurfaceQidKey(surface, item.qid)) ?? 0),
      0,
    ) ?? 0;

  return directScore + disambiguationScore + profileScore;
}

function createSurfaceQidKey(surface: string, qid: string): string {
  return `${surface}\0${qid}`;
}

export function createEnrichmentProgressReporter(
  progressTracker: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >,
): (event: WikipageResolveProgress) => Promise<void> {
  return async (event) => {
    await progressTracker.throwIfStopped();
    const phase = formatEnrichmentProgressPhase(event);

    await progressTracker.updatePhase({
      done: event.done,
      ...(phase.detail === undefined ? {} : { phaseDetail: phase.detail }),
      phase: "enrichment",
      total: event.total,
      unit: phase.unit,
    });
  };
}

function formatEnrichmentProgressPhase(event: WikipageResolveProgress): {
  readonly detail?: string;
  readonly unit: "page" | "qid" | "record";
} {
  switch (event.detail) {
    case "disambiguation-page":
      return {
        detail: "disambiguation",
        unit: "page",
      };
    case "entity":
      return {
        detail: "entity",
        unit: "record",
      };
    case "linked-page":
      return {
        detail: "linked",
        unit: "page",
      };
    case "page":
      return {
        detail: "page",
        unit: "page",
      };
    case "qid":
      return {
        unit: "qid",
      };
  }
}

async function mapLazyGuaranteedRequests<TItem, TResult>(
  request: GuaranteedRequestController,
  items: readonly TItem[],
  operation: (item: TItem, request: GuaranteedRequest) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const lazy = request.lazy;

  if (lazy !== undefined) {
    return await Promise.all(
      items.map(
        async (item) =>
          await lazy(async (request) => await operation(item, request)),
      ),
    );
  }

  const results: TResult[] = [];

  for (const item of items) {
    results.push(await operation(item, request));
  }

  return results;
}

async function discoverMentionLinks(input: {
  readonly fragments: readonly FragmentRecord[];
  readonly mentions: readonly MentionRecord[];
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
}): Promise<readonly MentionLinkRecord[]> {
  const fragmentWindows = buildMentionLinkWindows(
    input.fragments,
    input.mentions,
  );
  let completedWindows = 0;

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "relation-discovery",
    total: fragmentWindows.length,
    unit: "window",
  });

  const discoveredLinks = (
    await mapLazyGuaranteedRequests(
      input.request,
      fragmentWindows,
      async (item, request) => {
        try {
          await input.progressTracker?.throwIfStopped();
          return await discoverWikilinkRelations({
            chapterId: item.fragment.serialId,
            fragmentId: item.fragment.fragmentId,
            request,
            sentences: item.fragment.sentences,
            window: item.window,
          });
        } finally {
          completedWindows += 1;
          await input.progressTracker?.updatePhase({
            done: completedWindows,
            phase: "relation-discovery",
            total: fragmentWindows.length,
            unit: "window",
          });
        }
      },
    )
  ).flat();

  return discoveredLinks.map((link, index) => ({
    ...(link.confidence === undefined ? {} : { confidence: link.confidence }),
    evidenceSentenceIds: link.evidenceSentenceIds,
    id: `l${input.fragments[0]?.serialId ?? 0}-${index + 1}`,
    predicate: link.predicate,
    sourceMentionId: link.sourceMentionId,
    targetMentionId: link.targetMentionId,
  }));
}

function buildMentionLinkWindows(
  fragments: readonly FragmentRecord[],
  mentions: readonly MentionRecord[],
): ReadonlyArray<{
  readonly fragment: FragmentRecord;
  readonly window: WikilinkEvidenceWindow;
}> {
  return fragments.flatMap((fragment) => {
    const startSentenceIndex = fragment.fragmentId;
    const endSentenceIndex = startSentenceIndex + fragment.sentences.length - 1;
    const fragmentMentions = toWikilinkMentions(
      fragment.sentences,
      mentions.filter(
        (mention) =>
          mention.sentenceIndex !== undefined &&
          mention.sentenceIndex >= startSentenceIndex &&
          mention.sentenceIndex <= endSentenceIndex,
      ),
      startSentenceIndex,
    );
    const windows = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: WIKILINK_EVIDENCE_DISTANCE,
      mentions: fragmentMentions,
      text: joinSentences(fragment.sentences),
      windowLength: WIKILINK_WINDOW_LENGTH,
    });

    return windows.map((window) => ({
      fragment,
      window,
    }));
  });
}

function toWikilinkMentions(
  sentences: readonly WikilinkSentence[],
  mentions: readonly MentionRecord[],
  startSentenceIndex: number,
): readonly WikilinkMention[] {
  const sentenceOffsets = buildFragmentSentenceOffsets(sentences);

  return mentions.flatMap((mention) => {
    if (mention.sentenceIndex === undefined) {
      return [];
    }

    const sentenceOffset =
      sentenceOffsets[mention.sentenceIndex - startSentenceIndex];

    if (sentenceOffset === undefined) {
      return [];
    }

    return [
      {
        id: mention.id,
        qid: mention.qid,
        range: {
          end: sentenceOffset.start + mention.rangeEnd,
          start: sentenceOffset.start + mention.rangeStart,
        },
        surface: mention.surface,
      },
    ];
  });
}

function buildFragmentSentenceOffsets(
  sentences: readonly WikilinkSentence[],
): ReadonlyArray<{ readonly end: number; readonly start: number }> {
  const offsets: Array<{ readonly end: number; readonly start: number }> = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const start = cursor;
    const end = start + sentence.text.length;

    offsets.push({ end, start });
    cursor = end + 1;
  }

  return offsets;
}

function joinSentences(sentences: readonly WikilinkSentence[]): string {
  return sentences.map((sentence) => sentence.text).join(" ");
}

function countUniqueQids(candidates: readonly WikimatchCandidate[]): number {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.qidOptions.map((option) => option.qid),
    ),
  ).size;
}

function toMentionRecord(
  chapterId: number,
  mention: WikimatchAcceptedMention,
  location: {
    readonly rangeStart: number;
    readonly sentenceIndex: number;
  },
  index: number,
): MentionRecord {
  return {
    chapterId,
    ...(mention.confidence === undefined
      ? {}
      : { confidence: mention.confidence }),
    id: `m${chapterId}-${index}`,
    ...(mention.note === undefined ? {} : { note: mention.note }),
    qid: mention.qid,
    rangeEnd: location.rangeStart + mention.surface.length,
    rangeStart: location.rangeStart,
    sentenceIndex: location.sentenceIndex,
    surface: mention.surface,
  };
}

interface SentenceLocation {
  readonly absoluteStart: number;
  readonly length: number;
  readonly sentenceIndex: number;
}

function buildSentenceLocations(
  fragments: readonly FragmentRecord[],
): readonly SentenceLocation[] {
  const locations: SentenceLocation[] = [];
  let offset = 0;

  for (const fragment of fragments) {
    for (
      let sentenceIndex = 0;
      sentenceIndex < fragment.sentences.length;
      sentenceIndex += 1
    ) {
      const length = fragment.sentences[sentenceIndex]!.text.length;

      locations.push({
        absoluteStart: offset,
        length,
        sentenceIndex: fragment.fragmentId + sentenceIndex,
      });
      offset += length + 1;
    }
  }

  return locations;
}

function locateMention(
  locations: readonly SentenceLocation[],
  absoluteOffset: number,
): {
  readonly rangeStart: number;
  readonly sentenceIndex: number;
} {
  for (const location of locations) {
    const rangeEnd = location.absoluteStart + location.length;

    if (absoluteOffset >= location.absoluteStart && absoluteOffset < rangeEnd) {
      return {
        rangeStart: absoluteOffset - location.absoluteStart,
        sentenceIndex: location.sentenceIndex,
      };
    }
  }

  throw new Error(`Mention offset ${absoluteOffset} is outside chapter text.`);
}

async function readChapterFragments(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly FragmentRecord[]> {
  const serialFragments = document.getSerialFragments(chapterId);

  return await Promise.all(
    (await serialFragments.listFragmentIds()).map(
      async (fragmentId) => await serialFragments.getFragment(fragmentId),
    ),
  );
}

function joinFragmentText(fragments: readonly FragmentRecord[]): string {
  return fragments
    .flatMap((fragment) => fragment.sentences.map((sentence) => sentence.text))
    .join(" ");
}

function createWikimatchSentences(
  fragments: readonly FragmentRecord[],
): readonly WikimatchSentence[] {
  const sentences: WikimatchSentence[] = [];
  let offset = 0;

  for (const fragment of fragments) {
    for (let index = 0; index < fragment.sentences.length; index += 1) {
      const sentence = fragment.sentences[index]!;

      sentences.push({
        id: `${fragment.serialId}:${fragment.fragmentId + index}`,
        range: {
          end: offset + sentence.text.length,
          start: offset,
        },
        text: sentence.text,
      });
      offset += sentence.text.length + 1;
    }
  }

  return sentences;
}

export async function commitChapterKnowledgeGraphArtifact(
  document: Document,
  artifact: ChapterKnowledgeGraphBuildArtifact,
): Promise<void> {
  const mentions = await readJsonl(artifact.mentionsPath, parseMentionRecord);
  const mentionLinks = await readJsonl(
    artifact.mentionLinksPath,
    parseMentionLinkRecord,
  );

  validateChapterKnowledgeGraphArtifact(artifact.chapterId, {
    mentionLinks,
    mentions,
  });

  await document.openSession(async (openedDocument) => {
    await openedDocument.serials.ensure(artifact.chapterId);
    const existingLinks = await openedDocument.mentionLinks.listByChapter(
      artifact.chapterId,
    );

    if (existingLinks.length > 0 && mentionLinks.length === 0) {
      throw new Error(
        `Refusing to replace chapter ${artifact.chapterId} knowledge graph with an artifact that contains no mention links.`,
      );
    }

    await openedDocument.mentionLinks.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.saveMany(mentions);
    await openedDocument.mentionLinks.saveMany(mentionLinks);
    const parameter = await openedDocument.graphBuildParameters.save(
      artifact.parameter,
    );
    await openedDocument.serials.setKnowledgeGraphReady(
      artifact.chapterId,
      true,
      parameter.hash,
    );
  });
}

export async function clearChapterKnowledgeGraph(
  document: Document,
  chapterId: number,
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.mentionLinks.deleteByChapter(chapterId);
    await openedDocument.mentions.deleteByChapter(chapterId);
    await openedDocument.serials.setKnowledgeGraphReady(chapterId, false);
    await openedDocument.graphBuildParameters.deleteUnreferenced();
  });
}

function validateChapterKnowledgeGraphArtifact(
  chapterId: number,
  records: {
    readonly mentionLinks: readonly MentionLinkRecord[];
    readonly mentions: readonly MentionRecord[];
  },
): void {
  const mentionIds = new Set<string>();

  for (const mention of records.mentions) {
    if (mention.chapterId !== chapterId) {
      throw new Error(
        `Mention ${mention.id} belongs to chapter ${mention.chapterId}, expected chapter ${chapterId}.`,
      );
    }
    if (mention.rangeEnd <= mention.rangeStart) {
      throw new Error(
        `Mention ${mention.id} has invalid range [${mention.rangeStart}, ${mention.rangeEnd}).`,
      );
    }
    if (mentionIds.has(mention.id)) {
      throw new Error(`Duplicate mention id ${mention.id}.`);
    }

    mentionIds.add(mention.id);
  }

  const linkIds = new Set<string>();

  for (const link of records.mentionLinks) {
    if (linkIds.has(link.id)) {
      throw new Error(`Duplicate mention link id ${link.id}.`);
    }
    if (!mentionIds.has(link.sourceMentionId)) {
      throw new Error(
        `Mention link ${link.id} references unknown source mention ${link.sourceMentionId}.`,
      );
    }
    if (!mentionIds.has(link.targetMentionId)) {
      throw new Error(
        `Mention link ${link.id} references unknown target mention ${link.targetMentionId}.`,
      );
    }
    if (link.evidenceSentenceIds.length === 0) {
      throw new Error(`Mention link ${link.id} has no evidence sentences.`);
    }

    for (const sentenceId of link.evidenceSentenceIds) {
      if (sentenceId[0] !== chapterId) {
        throw new Error(
          `Mention link ${link.id} evidence sentence ${formatSentenceId(sentenceId)} is outside chapter ${chapterId}.`,
        );
      }
    }

    linkIds.add(link.id);
  }
}

function formatSentenceId(sentenceId: SentenceId): string {
  return sentenceId.join(":");
}

async function writeJsonl<T>(
  path: string,
  records: AsyncIterable<T> | Iterable<T>,
  parseRecord: (record: unknown) => T,
): Promise<void> {
  const stream = createWriteStream(path, { encoding: "utf8", flags: "wx" });

  try {
    for await (const record of records) {
      stream.write(`${JSON.stringify(parseRecord(record))}\n`);
    }
  } finally {
    await closeWritableStream(stream);
  }
}

async function readJsonl<T>(
  path: string,
  parseRecord: (record: unknown) => T,
): Promise<T[]> {
  const records: T[] = [];
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === "") {
      continue;
    }

    try {
      records.push(parseRecord(JSON.parse(line)));
    } catch (error) {
      throw new Error(`Invalid JSONL record at ${path}:${lineNumber}`, {
        cause: error,
      });
    }
  }

  return records;
}

function parseMentionRecord(record: unknown): MentionRecord {
  const parsed = mentionRecordSchema.parse(record);

  return {
    chapterId: parsed.chapterId,
    ...(parsed.confidence === undefined
      ? {}
      : { confidence: parsed.confidence }),
    id: parsed.id,
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
    qid: parsed.qid,
    rangeEnd: parsed.rangeEnd,
    rangeStart: parsed.rangeStart,
    ...(parsed.sentenceIndex === undefined
      ? {}
      : { sentenceIndex: parsed.sentenceIndex }),
    surface: parsed.surface,
  };
}

function parseMentionLinkRecord(record: unknown): MentionLinkRecord {
  const parsed = mentionLinkRecordSchema.parse(record);

  return {
    ...(parsed.confidence === undefined
      ? {}
      : { confidence: parsed.confidence }),
    evidenceSentenceIds: parsed.evidenceSentenceIds,
    id: parsed.id,
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
    predicate: parsed.predicate,
    sourceMentionId: parsed.sourceMentionId,
    targetMentionId: parsed.targetMentionId,
  };
}

async function closeWritableStream(
  stream: NodeJS.WritableStream,
): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.end((error?: Error | null) => {
      if (error !== undefined && error !== null) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}
