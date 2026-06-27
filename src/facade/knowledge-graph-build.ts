import { createReadStream, createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { z } from "zod";

import type { GuaranteedRequest } from "../guaranteed/index.js";
import type {
  Document,
  FragmentRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../document/index.js";
import {
  buildWikimatchSurfaceWindows,
  buildWikimatchWindows,
  countWikimatchCandidateOptions,
  enrichWikimatchCandidates,
  judgeWikimatchPolicy,
  judgeWikimatchSurfaceScreening,
  matchWikispineSentenceCandidates,
  narrowWikimatchCandidateOptions,
  WikimatchSurfaceBlocklist,
  type WikimatchAcceptedMention,
  type WikimatchCandidate,
  type WikimatchSentence,
} from "../wikimatch/index.js";

import { getChapterDetails } from "./chapter.js";
import type { BuildJobProgressReporter } from "./build-queue.js";

export interface ChapterKnowledgeGraphBuildArtifact {
  readonly chapterId: number;
  readonly mentionLinksPath: string;
  readonly mentionsPath: string;
  readonly workspacePath: string;
}

export interface BuildChapterKnowledgeGraphArtifactOptions {
  readonly mentionLinks:
    | AsyncIterable<MentionLinkRecord>
    | Iterable<MentionLinkRecord>;
  readonly mentions: AsyncIterable<MentionRecord> | Iterable<MentionRecord>;
  readonly workspacePath: string;
}

export interface GenerateChapterKnowledgeGraphArtifactOptions {
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<BuildJobProgressReporter, "updatePhase">;
  readonly request: GuaranteedRequest;
  readonly workspacePath: string;
}

const mentionRecordSchema = z.object({
  id: z.string().min(1),
  chapterId: z.number().int(),
  fragmentId: z.number().int(),
  sentenceIndex: z.number().int().nonnegative().optional(),
  rangeStart: z.number().int().nonnegative(),
  rangeEnd: z.number().int().nonnegative(),
  surface: z.string().min(1),
  qid: z.string().regex(/^Q[1-9][0-9]*$/),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

const mentionLinkRecordSchema = z.object({
  id: z.string().min(1),
  sourceMentionId: z.string().min(1),
  targetMentionId: z.string().min(1),
  predicate: z.string().min(1),
  evidenceStart: z.number().int().nonnegative().optional(),
  evidenceEnd: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

const WIKIMATCH_GROUNDING_OPTION_BUDGET = 35;

export async function generateChapterKnowledgeGraphArtifact(
  document: ReadonlyDocument,
  chapterId: number,
  options: GenerateChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage === "planned") {
    throw new Error(
      `Chapter ${chapterId} is planned. Set source before generating Knowledge Graph.`,
    );
  }

  const fragments = await readChapterFragments(document, chapterId);
  const text = joinFragmentText(fragments);
  const sentences = createWikimatchSentences(fragments);
  await options.progressTracker?.updatePhase({
    done: 0,
    phase: "matching",
    total: sentences.length,
    unit: "sentence",
  });
  const rawCandidates = await matchWikispineSentenceCandidates({
    includeDisambiguation: true,
    sentences,
  });
  await options.progressTracker?.updatePhase({
    done: sentences.length,
    phase: "matching",
    total: sentences.length,
    unit: "sentence",
  });
  const blocklist = await WikimatchSurfaceBlocklist.open();

  try {
    const screenedCandidates = await screenCandidates({
      blocklist,
      candidates: rawCandidates,
      policyPrompt: options.policyPrompt,
      ...(options.progressTracker === undefined
        ? {}
        : { progressTracker: options.progressTracker }),
      request: options.request,
      text,
    });
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
              progress: async (event) => {
                await options.progressTracker?.updatePhase({
                  done: event.done,
                  phase: "enrichment",
                  phaseDetail: event.detail,
                  total: event.total,
                  unit:
                    event.detail === "entity" || event.detail === "qid"
                      ? "qid"
                      : "page",
                });
              },
            }),
      },
    );
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
      policyPrompt: options.policyPrompt,
      ...(options.progressTracker === undefined
        ? {}
        : { progressTracker: options.progressTracker }),
      request: options.request,
      text,
    });
    await options.progressTracker?.updatePhase({
      done: 0,
      phase: "writing",
      total: mentions.length,
      unit: "record",
    });

    const artifact = await buildChapterKnowledgeGraphArtifact(chapterId, {
      mentionLinks: [],
      mentions,
      workspacePath: options.workspacePath,
    });
    await options.progressTracker?.updatePhase({
      done: mentions.length,
      phase: "writing",
      total: mentions.length,
      unit: "record",
    });

    return artifact;
  } finally {
    await blocklist.close();
  }
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
    workspacePath,
  };
}

async function screenCandidates(input: {
  readonly blocklist: WikimatchSurfaceBlocklist;
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<BuildJobProgressReporter, "updatePhase">;
  readonly request: GuaranteedRequest;
  readonly text: string;
}): Promise<readonly WikimatchCandidate[]> {
  const blockedSurfaces = await input.blocklist.getBlockedSurfaces(
    input.candidates.map((candidate) => candidate.surface),
  );
  const candidates = input.candidates.filter(
    (candidate) => !blockedSurfaces.has(candidate.surface),
  );

  if (candidates.length === 0) {
    return [];
  }

  const allowedSurfaces = new Set<string>();
  const windows = buildWikimatchSurfaceWindows({
    candidates,
    contextWords: 180,
    surfaceBudget: 60,
    text: input.text,
  });
  let completedWindows = 0;

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "screening",
    total: windows.length,
    unit: "window",
  });
  const results = await Promise.all(
    windows.map(async (window) => {
      try {
        return await judgeWikimatchSurfaceScreening({
          policyPrompt: input.policyPrompt,
          request: input.request,
          window,
        });
      } finally {
        completedWindows += 1;
        await input.progressTracker?.updatePhase({
          done: completedWindows,
          phase: "screening",
          total: windows.length,
          unit: "window",
        });
      }
    }),
  );

  for (const result of results) {
    for (const surface of result.surfaces) {
      if (surface.decision === "allow") {
        allowedSurfaces.add(surface.text);
      }
    }
    await input.blocklist.put(
      result.surfaces
        .filter((surface) => surface.decision === "global_blocklist_candidate")
        .map((surface) => ({
          ...(surface.note === undefined ? {} : { note: surface.note }),
          surface: surface.text,
        })),
    );
  }

  return candidates.filter((candidate) =>
    allowedSurfaces.has(candidate.surface),
  );
}

async function judgeCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly chapterId: number;
  readonly fragments: readonly FragmentRecord[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<BuildJobProgressReporter, "updatePhase">;
  readonly request: GuaranteedRequest;
  readonly text: string;
}): Promise<readonly MentionRecord[]> {
  const mentions: MentionRecord[] = [];
  let mentionIndex = 1;
  const candidates = await narrowOversizedCandidates(input);
  const windows = buildWikimatchWindows({
    candidates,
    contextWords: 220,
    optionBudget: WIKIMATCH_GROUNDING_OPTION_BUDGET,
    text: input.text,
  });
  let completedWindows = 0;

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "grounding",
    total: windows.length,
    unit: "window",
  });
  const results = await Promise.all(
    windows.map(async (window) => {
      try {
        return await judgeWikimatchPolicy({
          candidates: window.candidates,
          policyPrompt: input.policyPrompt,
          request: input.request,
          window,
        });
      } finally {
        completedWindows += 1;
        await input.progressTracker?.updatePhase({
          done: completedWindows,
          phase: "grounding",
          total: windows.length,
          unit: "window",
        });
      }
    }),
  );

  const sentenceLocations = buildSentenceLocations(input.fragments);

  for (const result of results) {
    for (const mention of result.mentions) {
      const location = locateMention(sentenceLocations, mention.range.start);

      mentions.push(
        toMentionRecord(input.chapterId, mention, location, mentionIndex),
      );
      mentionIndex += 1;
    }
  }

  return mentions;
}

async function narrowOversizedCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly policyPrompt: string;
  readonly progressTracker?: Pick<BuildJobProgressReporter, "updatePhase">;
  readonly request: GuaranteedRequest;
  readonly text: string;
}): Promise<readonly WikimatchCandidate[]> {
  const oversizedCandidates = input.candidates.filter(
    (candidate) =>
      countWikimatchCandidateOptions(candidate) >
      WIKIMATCH_GROUNDING_OPTION_BUDGET,
  );
  let completedCandidates = 0;

  if (oversizedCandidates.length > 0) {
    await input.progressTracker?.updatePhase({
      done: 0,
      phase: "narrowing",
      total: oversizedCandidates.length,
      unit: "candidate",
    });
  }

  return (
    await Promise.all(
      input.candidates.map(async (candidate) => {
        if (
          countWikimatchCandidateOptions(candidate) <=
          WIKIMATCH_GROUNDING_OPTION_BUDGET
        ) {
          return candidate;
        }

        let result: Awaited<ReturnType<typeof narrowWikimatchCandidateOptions>>;

        try {
          result = await narrowWikimatchCandidateOptions({
            candidate,
            optionBudget: WIKIMATCH_GROUNDING_OPTION_BUDGET,
            policyPrompt: input.policyPrompt,
            request: input.request,
            text: input.text,
          });
        } finally {
          completedCandidates += 1;
          await input.progressTracker?.updatePhase({
            done: completedCandidates,
            phase: "narrowing",
            total: oversizedCandidates.length,
            unit: "candidate",
          });
        }

        return result.candidate.qidOptions.length > 0
          ? result.candidate
          : undefined;
      }),
    )
  ).filter(
    (candidate): candidate is WikimatchCandidate => candidate !== undefined,
  );
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
    readonly fragmentId: number;
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
    fragmentId: location.fragmentId,
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
  readonly fragmentId: number;
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
        fragmentId: fragment.fragmentId,
        length,
        sentenceIndex,
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
  readonly fragmentId: number;
  readonly rangeStart: number;
  readonly sentenceIndex: number;
} {
  for (const location of locations) {
    const rangeEnd = location.absoluteStart + location.length;

    if (absoluteOffset >= location.absoluteStart && absoluteOffset < rangeEnd) {
      return {
        fragmentId: location.fragmentId,
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
        id: `${fragment.serialId}:${fragment.fragmentId}:${index}`,
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
    await openedDocument.mentionLinks.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.saveMany(mentions);
    await openedDocument.mentionLinks.saveMany(mentionLinks);
  });
}

export async function clearChapterKnowledgeGraph(
  document: Document,
  chapterId: number,
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.mentionLinks.deleteByChapter(chapterId);
    await openedDocument.mentions.deleteByChapter(chapterId);
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
    if (
      link.evidenceStart !== undefined &&
      link.evidenceEnd !== undefined &&
      link.evidenceEnd <= link.evidenceStart
    ) {
      throw new Error(
        `Mention link ${link.id} has invalid evidence range [${link.evidenceStart}, ${link.evidenceEnd}).`,
      );
    }

    linkIds.add(link.id);
  }
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
    fragmentId: parsed.fragmentId,
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
    ...(parsed.evidenceEnd === undefined
      ? {}
      : { evidenceEnd: parsed.evidenceEnd }),
    ...(parsed.evidenceStart === undefined
      ? {}
      : { evidenceStart: parsed.evidenceStart }),
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
