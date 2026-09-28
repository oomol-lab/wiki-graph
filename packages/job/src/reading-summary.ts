import type {
  ChapterJobArtifactRecord,
  JobFragmentGroupRecord,
  JobOptionsRecord,
  JobReadingChunkRecord,
  JobSourceSentenceRecord,
} from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import type { JobFile } from "./platform.js";
import type { JobLlm, JobLlmMessage } from "./ports.js";

export async function* buildReadingSummaryRecords(options: {
  readonly inputFile: JobFile;
  readonly llm: JobLlm;
  readonly signal?: AbortSignal;
}): AsyncIterable<ChapterJobArtifactRecord> {
  const metadata = await inspectInput(options.inputFile);
  if (metadata.fragmentCount <= 1) {
    const text = await readSentenceText(options.inputFile);
    if (text !== "") yield { position: 0, text, type: "summary-part" };
    return;
  }

  const groups =
    metadata.groups.length === 0
      ? [await wholeInputRange(options.inputFile)]
      : metadata.groups;
  let position = 0;
  for (const group of groups) {
    if (group === undefined) continue;
    const input = await readGroupInput(options.inputFile, group);
    if (input.sentences.length === 0) continue;
    const markedText = markRetainedSentences(input.sentences, input.chunks);
    const summary = await compress(markedText, metadata.jobOptions, options);
    if (summary.trim() === "") continue;
    yield { position, text: summary.trim(), type: "summary-part" };
    position += 1;
  }
}

async function inspectInput(file: JobFile): Promise<{
  readonly fragmentCount: number;
  readonly groups: readonly JobFragmentGroupRecord[];
  readonly jobOptions: JobOptionsRecord;
}> {
  let fragmentCount = 0;
  const groups: JobFragmentGroupRecord[] = [];
  let jobOptions: JobOptionsRecord = { type: "job-options" };
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "source-fragment") fragmentCount += 1;
    else if (record.type === "fragment-group") groups.push(record);
    else if (record.type === "job-options") jobOptions = record;
  }
  groups.sort((left, right) => left.groupId - right.groupId);
  return { fragmentCount, groups, jobOptions };
}

async function readSentenceText(file: JobFile): Promise<string> {
  const text: string[] = [];
  for await (const record of readChapterJobInput(file)) {
    if (record.type === "source-sentence") text.push(record.text);
  }
  return text.join(" ").trim();
}

async function wholeInputRange(
  file: JobFile,
): Promise<JobFragmentGroupRecord | undefined> {
  let start = Infinity;
  let end = -1;
  for await (const record of readChapterJobInput(file)) {
    if (record.type !== "source-sentence") continue;
    start = Math.min(start, record.sentenceIndex);
    end = Math.max(end, record.sentenceIndex);
  }
  return end < 0
    ? undefined
    : {
        endSentenceIndex: end,
        groupId: 0,
        startSentenceIndex: start,
        type: "fragment-group",
      };
}

async function readGroupInput(
  file: JobFile,
  group: JobFragmentGroupRecord,
): Promise<{
  readonly chunks: readonly JobReadingChunkRecord[];
  readonly sentences: readonly JobSourceSentenceRecord[];
}> {
  const chunks: JobReadingChunkRecord[] = [];
  const sentences: JobSourceSentenceRecord[] = [];
  for await (const record of readChapterJobInput(file)) {
    if (
      record.type === "source-sentence" &&
      record.sentenceIndex >= group.startSentenceIndex &&
      record.sentenceIndex <= group.endSentenceIndex
    ) {
      sentences.push(record);
    } else if (
      record.type === "reading-chunk" &&
      record.sentenceIndexes.some(
        (index) =>
          index >= group.startSentenceIndex && index <= group.endSentenceIndex,
      )
    ) {
      chunks.push(record);
    }
  }
  return { chunks, sentences };
}

function markRetainedSentences(
  sentences: readonly JobSourceSentenceRecord[],
  chunks: readonly JobReadingChunkRecord[],
): string {
  const bySentence = new Map<number, JobReadingChunkRecord[]>();
  for (const chunk of chunks) {
    for (const sentenceIndex of chunk.sentenceIndexes) {
      const values = bySentence.get(sentenceIndex) ?? [];
      values.push(chunk);
      bySentence.set(sentenceIndex, values);
    }
  }
  return sentences
    .map((sentence) => {
      const retained = bySentence.get(sentence.sentenceIndex);
      if (retained === undefined || retained.length === 0) return sentence.text;
      const retention = strongestRetention(retained);
      return `<chunk retention="${retention}">${sentence.text}</chunk>`;
    })
    .join(" ");
}

function strongestRetention(
  chunks: readonly JobReadingChunkRecord[],
): "detailed" | "focused" | "relevant" | "verbatim" {
  const rank = { detailed: 3, focused: 2, relevant: 1, verbatim: 4 } as const;
  let selected: keyof typeof rank = "relevant";
  for (const chunk of chunks) {
    const retention =
      chunk.retention ??
      (chunk.importance === "critical"
        ? "detailed"
        : chunk.importance === "important"
          ? "focused"
          : "relevant");
    if (rank[retention] > rank[selected]) selected = retention;
  }
  return selected;
}

async function compress(
  markedText: string,
  jobOptions: JobOptionsRecord,
  options: { readonly llm: JobLlm; readonly signal?: AbortSignal },
): Promise<string> {
  const targetLength = Math.max(1, Math.floor(markedText.length * 0.2));
  let messages: JobLlmMessage[] = [
    {
      content: [
        "Compress the supplied book segment into continuous prose while preserving marked content.",
        `Target about ${targetLength} characters.`,
        "verbatim and detailed chunks have highest priority; focused and relevant chunks may be compressed more aggressively.",
        "Remove every <chunk> tag from the output.",
        jobOptions.language === undefined
          ? "Keep the source language."
          : `Write in ${jobOptions.language}.`,
        jobOptions.prompt ?? "",
        "Return exactly one <final>...</final> block and nothing else.",
      ]
        .filter((part) => part !== "")
        .join(" "),
      role: "system" as const,
    },
    { content: markedText, role: "user" as const },
  ];
  const retryMax = 2;
  for (let retryIndex = 0; retryIndex <= retryMax; retryIndex += 1) {
    const response = await options.llm.request(messages, {
      retryIndex,
      retryMax,
      scope: "reading-summary-compression",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const match = /^\s*<final>([\s\S]*?)<\/final>\s*$/u.exec(response);
    const text = match?.[1]?.trim();
    if (text !== undefined && text !== "" && !/<\/?chunk\b/iu.test(text)) {
      return text;
    }
    messages = [
      ...messages,
      { content: response, role: "assistant" as const },
      {
        content:
          "The response was invalid. Return exactly one non-empty <final>...</final> block, with plain text and no chunk tags.",
        role: "user" as const,
      },
    ];
  }
  throw new Error("Reading Summary compression returned an invalid response.");
}
