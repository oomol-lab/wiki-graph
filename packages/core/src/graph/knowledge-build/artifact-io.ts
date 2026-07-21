import { createReadStream, createWriteStream } from "fs";
import { createInterface } from "readline";
import { z } from "zod";

import type {
  MentionLinkRecord,
  MentionRecord,
  SentenceId,
} from "../../document/index.js";

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

export function validateChapterKnowledgeGraphArtifact(
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

export async function writeJsonl<T>(
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

export async function readJsonl<T>(
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

export function parseMentionRecord(record: unknown): MentionRecord {
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

export function parseMentionLinkRecord(record: unknown): MentionLinkRecord {
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
