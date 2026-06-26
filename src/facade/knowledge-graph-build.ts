import { createReadStream, createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { z } from "zod";

import type {
  Document,
  MentionLinkRecord,
  MentionRecord,
} from "../document/index.js";

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

const mentionRecordSchema = z.object({
  id: z.string().min(1),
  chapterId: z.number().int(),
  fragmentId: z.number().int(),
  sentenceIndex: z.number().int().optional(),
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
