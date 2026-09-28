import { z } from "zod";

import type {
  ChapterJobArtifactRecord,
  JobOptionsRecord,
  JobSourceSentenceRecord,
} from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import { requestJobJson } from "./llm-json.js";
import type { JobFile } from "./platform.js";
import type {
  JobLlm,
  JobWikimediaResolution,
  JobWikimediaResolver,
  JobWikispineMatcher,
} from "./ports.js";

const BATCH_SENTENCES = 32;

const responseSchema = z.object({
  links: z.array(
    z.object({
      confidence: z.number().min(0).max(1).optional(),
      evidenceSentenceIndexes: z.array(z.number().int().nonnegative()).min(1),
      note: z.string().optional(),
      predicate: z.string().min(1),
      sourceMention: z.number().int().nonnegative(),
      targetMention: z.number().int().nonnegative(),
    }),
  ),
  mentions: z.array(
    z.object({
      candidate: z.number().int().nonnegative(),
      confidence: z.number().min(0).max(1).optional(),
      note: z.string().optional(),
      qid: z.string().regex(/^Q[1-9][0-9]*$/u),
    }),
  ),
});

interface Candidate {
  readonly end: number;
  readonly qids: readonly {
    readonly disambiguation: boolean;
    readonly qid: string;
  }[];
  readonly start: number;
  readonly surface: string;
}

export async function* buildKnowledgeGraphRecords(options: {
  readonly inputFile: JobFile;
  readonly llm: JobLlm;
  readonly signal?: AbortSignal;
  readonly wikimedia: JobWikimediaResolver;
  readonly wikispine: JobWikispineMatcher;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const jobOptions = await readOptions(options.inputFile);
  yield {
    ...(jobOptions.language === undefined
      ? {}
      : { language: jobOptions.language }),
    prompt: jobOptions.policyPrompt ?? "",
    scope: "knowledge-graph",
    type: "job-parameter",
  };

  let batch: JobSourceSentenceRecord[] = [];
  let nextMentionId = 1;
  let nextLinkId = 1;
  for await (const record of readChapterJobInput(options.inputFile)) {
    if (record.type !== "source-sentence") continue;
    batch.push(record);
    if (batch.length < BATCH_SENTENCES) continue;
    const result = await processBatch(
      batch,
      nextMentionId,
      nextLinkId,
      jobOptions,
      options,
    );
    yield* result.records;
    nextMentionId = result.nextMentionId;
    nextLinkId = result.nextLinkId;
    batch = [];
  }
  if (batch.length > 0) {
    const result = await processBatch(
      batch,
      nextMentionId,
      nextLinkId,
      jobOptions,
      options,
    );
    yield* result.records;
  }
}

async function processBatch(
  sentences: readonly JobSourceSentenceRecord[],
  nextMentionId: number,
  nextLinkId: number,
  jobOptions: JobOptionsRecord,
  options: {
    readonly llm: JobLlm;
    readonly signal?: AbortSignal;
    readonly wikimedia: JobWikimediaResolver;
    readonly wikispine: JobWikispineMatcher;
  },
): Promise<{
  readonly nextLinkId: number;
  readonly nextMentionId: number;
  readonly records: readonly ChapterJobArtifactRecord[];
}> {
  const located = locateSentences(sentences);
  const matches = await options.wikispine.match({
    includeDisambiguation: true,
    sentences: located.map((sentence) => ({
      id: String(sentence.record.sentenceIndex),
      range: { end: sentence.end, start: sentence.start },
      text: sentence.record.text,
    })),
  });
  const text = located.map((sentence) => sentence.record.text).join(" ");
  const candidates: Candidate[] = matches.flatMap((match) => {
    if (
      match.start < 0 ||
      match.end <= match.start ||
      match.end > text.length
    ) {
      return [];
    }
    return [{ ...match, surface: text.slice(match.start, match.end) }];
  });
  if (candidates.length === 0) {
    return { nextLinkId, nextMentionId, records: [] };
  }
  const requestedQids = uniqueQids(
    candidates.flatMap((candidate) => candidate.qids),
  );
  const resolutions = await options.wikimedia.resolve(requestedQids);
  const resolutionByQid = new Map(resolutions.map((item) => [item.qid, item]));
  const allowedQids = new Set(requestedQids.map((item) => item.qid));
  for (const resolution of resolutions) {
    for (const meaning of resolution.disambiguation ?? []) {
      allowedQids.add(meaning.qid);
    }
  }
  const response = await requestJobJson({
    llm: options.llm,
    messages: [
      {
        content: [
          "Build a grounded Knowledge Graph from the source and entity candidates.",
          "Return JSON with mentions and links. A mention selects a candidate index and one allowed QID.",
          "Reject irrelevant candidates. Links must reference indexes in the returned mentions array and use a concise predicate.",
          "Evidence sentence indexes must come from the source.",
          jobOptions.language === undefined
            ? ""
            : `Use ${jobOptions.language} for predicates and notes.`,
          jobOptions.policyPrompt ?? "",
        ]
          .filter((part) => part !== "")
          .join(" "),
        role: "system",
      },
      {
        content: JSON.stringify({
          candidates: candidates.map((candidate, index) => ({
            index,
            options: candidate.qids.map((qid) => ({
              ...qid,
              resolution: formatResolution(resolutionByQid.get(qid.qid)),
            })),
            range: { end: candidate.end, start: candidate.start },
            surface: candidate.surface,
          })),
          sentences: sentences.map((sentence) => ({
            index: sentence.sentenceIndex,
            text: sentence.text,
          })),
        }),
        role: "user",
      },
    ],
    schema: responseSchema,
    scope: "knowledge-graph-grounding",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const records: ChapterJobArtifactRecord[] = [];
  const mentionIds: string[] = [];
  for (const selected of response.mentions) {
    const candidate = candidates[selected.candidate];
    if (candidate === undefined || !allowedQids.has(selected.qid)) continue;
    const location = locateOffset(located, candidate.start);
    if (location === undefined) continue;
    const id = `mention-${nextMentionId}`;
    nextMentionId += 1;
    mentionIds.push(id);
    records.push({
      ...(selected.confidence === undefined
        ? {}
        : { confidence: selected.confidence }),
      ...(location.record.fragmentId === undefined
        ? {}
        : { fragmentId: location.record.fragmentId }),
      id,
      ...(selected.note === undefined ? {} : { note: selected.note }),
      qid: selected.qid,
      rangeEnd: location.rangeStart + candidate.surface.length,
      rangeStart: location.rangeStart,
      sentenceIndex: location.record.sentenceIndex,
      surface: candidate.surface,
      type: "mention",
    });
  }
  const validSentenceIndexes = new Set(
    sentences.map((item) => item.sentenceIndex),
  );
  for (const link of response.links) {
    const sourceMentionId = mentionIds[link.sourceMention];
    const targetMentionId = mentionIds[link.targetMention];
    const evidenceSentenceIndexes = [
      ...new Set(link.evidenceSentenceIndexes),
    ].filter((index) => validSentenceIndexes.has(index));
    if (
      sourceMentionId === undefined ||
      targetMentionId === undefined ||
      evidenceSentenceIndexes.length === 0
    ) {
      continue;
    }
    records.push({
      ...(link.confidence === undefined ? {} : { confidence: link.confidence }),
      evidenceSentenceIndexes,
      id: `link-${nextLinkId}`,
      ...(link.note === undefined ? {} : { note: link.note }),
      predicate: link.predicate,
      sourceMentionId,
      targetMentionId,
      type: "mention-link",
    });
    nextLinkId += 1;
  }
  return { nextLinkId, nextMentionId, records };
}

function locateSentences(sentences: readonly JobSourceSentenceRecord[]) {
  let offset = 0;
  return sentences.map((record) => {
    const start = offset;
    const end = start + record.text.length;
    offset = end + 1;
    return { end, record, start };
  });
}

function locateOffset(
  sentences: ReturnType<typeof locateSentences>,
  offset: number,
) {
  const sentence = sentences.find(
    (item) => offset >= item.start && offset < item.end,
  );
  return sentence === undefined
    ? undefined
    : { ...sentence, rangeStart: offset - sentence.start };
}

function uniqueQids(
  values: readonly { readonly disambiguation: boolean; readonly qid: string }[],
) {
  const byQid = new Map<string, boolean>();
  for (const value of values) {
    byQid.set(
      value.qid,
      (byQid.get(value.qid) ?? false) || value.disambiguation,
    );
  }
  return [...byQid].map(([qid, disambiguation]) => ({ disambiguation, qid }));
}

function formatResolution(resolution: JobWikimediaResolution | undefined) {
  if (resolution === undefined) return undefined;
  return {
    ...(resolution.disambiguation === undefined
      ? {}
      : { disambiguation: resolution.disambiguation }),
    en: resolution.en,
    zh: resolution.zh,
  };
}

async function readOptions(file: JobFile): Promise<JobOptionsRecord> {
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "job-options") return record;
  }
  return { type: "job-options" };
}
