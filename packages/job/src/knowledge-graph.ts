import type {
  ChapterJobArtifactRecord,
  JobOptionsRecord,
  JobSourceSentenceRecord,
} from "./file-contracts.js";
import {
  RESPONSE_INTENT_CLASSIFIER_PROMPT,
  type GuaranteedRequestController,
} from "./guaranteed/index.js";
import { readChapterJobInput } from "./jsonl.js";
import {
  countUniqueQids,
  screenCandidates,
} from "./knowledge/pipeline/candidates.js";
import { groundWikimatchCandidates } from "./knowledge/pipeline/grounding-runner.js";
import { discoverMentionLinks } from "./knowledge/pipeline/relations.js";
import type {
  FragmentRecord,
  KnowledgeGraphProgressTracker,
  MentionRecord,
} from "./knowledge/types.js";
import {
  enrichWikimatchCandidates,
  type WikimatchCandidate,
} from "./knowledge/wikimatch/index.js";
import type { JobFile } from "./platform.js";
import type {
  JobLlm,
  JobProgressSink,
  JobWikimediaResolver,
  JobWikispineMatcher,
} from "./ports.js";
import { JOB_LLM_SCOPES } from "./sampling.js";

const DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT = [
  "Recall only source mentions that should become stable searchable knowledge graph objects.",
  "Prefer named entities: historical persons, places, organizations, dynasties, political entities, named works, named events, battles, titles, and explicitly named domain concepts.",
  "Recall a non-named common concept only when it is a central recurring topic of the chapter and would be useful as an entity search result across multiple evidence passages.",
  "Do not recall a surface merely because it is useful for summarizing the story or explaining a detail.",
  "Do not recall pure numbers, standalone dates without a named event role, units of measurement, dimensions, ordinal labels, chapter numbers, punctuation fragments, common function words, generic verbs, generic adjectives, generic roles, generic objects, or incidental attributes.",
  "Measurements, quantities, dimensions, tactical details, and descriptive attributes should remain evidence text, not entity mentions.",
  "When uncertain, skip the mention rather than creating a noisy knowledge graph object.",
].join(" ");

export async function* buildKnowledgeGraphRecords(options: {
  readonly inputFile: JobFile;
  readonly language?: string;
  readonly llm: JobLlm;
  readonly prompt?: string;
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
  readonly wikimedia: JobWikimediaResolver;
  readonly wikispine: JobWikispineMatcher;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const input = await readKnowledgeInput(options.inputFile);
  const language = options.language ?? input.jobOptions.language;
  const policyPrompt = resolvePolicyPrompt(
    options.prompt ?? input.jobOptions.prompt,
  );
  yield {
    ...(language === undefined ? {} : { language }),
    prompt: policyPrompt,
    scope: "knowledge-graph",
    type: "job-parameter",
  };

  const progressTracker = createProgressTracker(options.progress);
  const text = input.sentences.map((sentence) => sentence.text).join(" ");
  const located = locateSentences(input.sentences);
  await progressTracker.updatePhase({
    done: 0,
    phase: "matching",
    phaseDetail: "text",
    total: text.length,
    unit: "char",
  });
  const matched = [];
  for await (const match of options.wikispine.match({
    includeDisambiguation: true,
    onProgress: async (progress) => {
      await progressTracker.updatePhase({
        done: progress.coveredRangeEnd,
        force: false,
        phase: "matching",
        phaseDetail: "text",
        total: text.length,
        unit: "char",
      });
    },
    sentences: located.map((sentence) => ({
      id: String(sentence.record.sentenceIndex),
      range: { end: sentence.end, start: sentence.start },
      text: sentence.record.text,
    })),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })) {
    matched.push(match);
  }
  await progressTracker.throwIfStopped();
  await progressTracker.updatePhase({
    done: text.length,
    phase: "matching",
    phaseDetail: "text",
    total: text.length,
    unit: "char",
  });

  const rawCandidates: WikimatchCandidate[] = matched.flatMap(
    (candidate, index) => {
      if (
        candidate.start < 0 ||
        candidate.end <= candidate.start ||
        candidate.end > text.length
      ) {
        return [];
      }
      return [
        {
          id: `c${index + 1}`,
          qidOptions: candidate.qids.map((option) => ({
            isDisambiguation: option.disambiguation,
            qid: option.qid,
          })),
          range: { end: candidate.end, start: candidate.start },
          surface: text.slice(candidate.start, candidate.end),
        },
      ];
    },
  );
  const request = createGuaranteedRequest(options);
  const screenedCandidates = await screenCandidates({
    candidates: rawCandidates,
    policyPrompt,
    progressTracker,
    request,
    text,
  });
  await progressTracker.throwIfStopped();

  const qidCount = countUniqueQids(screenedCandidates);
  await progressTracker.updatePhase({
    done: 0,
    phase: "enrichment",
    total: qidCount,
    unit: "qid",
  });
  const enrichedCandidates = await enrichWikimatchCandidates(
    screenedCandidates,
    {
      ...(language === undefined ? {} : { language }),
      onProgress: async (done) => {
        await progressTracker.updatePhase({
          done,
          force: false,
          phase: "enrichment",
          total: qidCount,
          unit: "qid",
        });
      },
      resolver: options.wikimedia,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  await progressTracker.throwIfStopped();
  await progressTracker.updatePhase({
    done: qidCount,
    phase: "enrichment",
    total: qidCount,
    unit: "qid",
  });

  const accepted = await groundWikimatchCandidates({
    candidates: enrichedCandidates,
    policyPrompt,
    progressTracker,
    request,
    text,
  });
  await progressTracker.throwIfStopped();
  const mentions = accepted.map((mention, index) =>
    toMentionRecord(mention, located, index + 1),
  );
  for (const mention of mentions) {
    const { chapterId: _, ...record } = mention;
    yield { ...record, type: "mention" };
  }

  const links = await discoverMentionLinks({
    fragments: input.fragments,
    mentions,
    progressTracker,
    request,
  });
  await progressTracker.throwIfStopped();
  for (const [index, link] of links.entries()) {
    yield {
      ...(link.confidence === undefined ? {} : { confidence: link.confidence }),
      evidenceSentenceIndexes: link.evidenceSentenceIds.map(
        (sentenceId) => sentenceId[1],
      ),
      id: `link-${index + 1}`,
      ...(link.note === undefined ? {} : { note: link.note }),
      predicate: link.predicate,
      sourceMentionId: link.sourceMentionId,
      targetMentionId: link.targetMentionId,
      type: "mention-link",
    };
  }
}

function createGuaranteedRequest(options: {
  readonly llm: JobLlm;
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
}): GuaranteedRequestController {
  return async (messages, retryIndex, retryMax) => {
    const response = await options.llm.request(messages, {
      retryIndex,
      retryMax,
      scope:
        messages[0]?.content === RESPONSE_INTENT_CLASSIFIER_PROMPT
          ? JOB_LLM_SCOPES.guaranteedResponseIntent
          : JOB_LLM_SCOPES.knowledgeGraph,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.progress?.addTokenUsage === undefined
        ? {}
        : {
            onTokenUsage: async (usage) =>
              await options.progress?.addTokenUsage?.(usage),
          }),
    });
    await options.progress?.addOutputCharacters?.(response.length);
    return response;
  };
}

function createProgressTracker(
  progress: JobProgressSink | undefined,
): KnowledgeGraphProgressTracker {
  return {
    async throwIfStopped() {
      await progress?.throwIfStopped?.();
    },
    async updatePhase(input) {
      await progress?.updatePhase?.(input);
    },
  };
}

function resolvePolicyPrompt(prompt: string | undefined): string {
  const normalized = prompt?.trim();
  return normalized === undefined || normalized === ""
    ? DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT
    : normalized;
}

async function readKnowledgeInput(file: JobFile): Promise<{
  readonly fragments: readonly FragmentRecord[];
  readonly jobOptions: JobOptionsRecord;
  readonly sentences: readonly JobSourceSentenceRecord[];
}> {
  const fragmentSummaries = new Map<number, string>();
  const sentences: JobSourceSentenceRecord[] = [];
  let jobOptions: JobOptionsRecord = { type: "job-options" };
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "job-options") jobOptions = record;
    else if (record.type === "source-fragment") {
      fragmentSummaries.set(record.fragmentId, record.summary);
    } else if (record.type === "source-sentence") {
      sentences.push(record);
    }
  }
  sentences.sort((left, right) => left.sentenceIndex - right.sentenceIndex);
  const fragmentIds = [
    ...new Set(
      sentences.map(
        (sentence) => sentence.fragmentId ?? sentence.sentenceIndex,
      ),
    ),
  ].sort((left, right) => left - right);
  return {
    fragments: fragmentIds.map((fragmentId) => ({
      fragmentId,
      sentences: sentences
        .filter(
          (sentence) =>
            (sentence.fragmentId ?? sentence.sentenceIndex) === fragmentId,
        )
        .map((sentence) => ({
          text: sentence.text,
          wordsCount: sentence.wordsCount,
        })),
      serialId: 0,
      summary: fragmentSummaries.get(fragmentId) ?? "",
    })),
    jobOptions,
    sentences,
  };
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

function toMentionRecord(
  mention: {
    readonly confidence?: number;
    readonly note?: string;
    readonly qid: string;
    readonly range: { readonly end: number; readonly start: number };
    readonly surface: string;
  },
  locations: ReturnType<typeof locateSentences>,
  index: number,
): MentionRecord {
  const location = locations.find(
    (item) =>
      mention.range.start >= item.start && mention.range.start < item.end,
  );
  if (location === undefined) {
    throw new Error(
      `Mention offset ${mention.range.start} is outside chapter text.`,
    );
  }
  const rangeStart = mention.range.start - location.start;
  return {
    chapterId: 0,
    ...(mention.confidence === undefined
      ? {}
      : { confidence: mention.confidence }),
    ...(location.record.fragmentId === undefined
      ? {}
      : { fragmentId: location.record.fragmentId }),
    id: `mention-${index}`,
    ...(mention.note === undefined ? {} : { note: mention.note }),
    qid: mention.qid,
    rangeEnd: rangeStart + mention.surface.length,
    rangeStart,
    sentenceIndex: location.record.sentenceIndex,
    surface: mention.surface,
  };
}
