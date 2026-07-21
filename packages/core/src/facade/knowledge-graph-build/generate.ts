import type { ReadonlyDocument } from "../../document/index.js";
import {
  enrichWikimatchCandidates,
  matchWikispineSentenceCandidates,
} from "../../wikimatch/index.js";
import { resolveKnowledgeGraphRecallPrompt } from "../prompts.js";
import { buildChapterKnowledgeGraphArtifact } from "./artifact.js";
import { countUniqueQids, screenCandidates } from "./candidates.js";
import {
  createWikimatchSentences,
  joinFragmentText,
} from "./fragments.js";
import { judgeCandidates } from "./mentions.js";
import { createKnowledgeGraphParameterInput } from "./parameter.js";
import { createEnrichmentProgressReporter } from "./progress.js";
import { discoverMentionLinks } from "./relations.js";
import { snapshotChapterKnowledgeGraphInput } from "./snapshot.js";
import type {
  ChapterKnowledgeGraphBuildArtifact,
  ChapterKnowledgeGraphInputSnapshot,
  GenerateChapterKnowledgeGraphArtifactOptions,
} from "./types.js";

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

  return await buildChapterKnowledgeGraphArtifact(chapterId, {
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
}
