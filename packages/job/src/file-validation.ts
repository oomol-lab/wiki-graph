import type { ChapterJobKind } from "./contracts.js";
import type { ChapterJobInputRecord } from "./file-contracts.js";
import { readChapterJobInput } from "./jsonl.js";
import type { JobFile } from "./platform.js";

const allowedTypes: Readonly<
  Record<ChapterJobKind, ReadonlySet<ChapterJobInputRecord["type"]>>
> = {
  "index-embedding-source": new Set(["source-sentence"]),
  "index-embedding-summary": new Set(["summary-sentence"]),
  "index-fts": new Set([
    "chapter-title",
    "mention",
    "reading-chunk",
    "source-sentence",
    "summary-sentence",
  ]),
  "knowledge-graph": new Set([
    "job-options",
    "source-fragment",
    "source-sentence",
  ]),
  "reading-graph": new Set(["job-options", "source-text"]),
  "reading-summary": new Set([
    "fragment-group",
    "job-options",
    "mention",
    "reading-chunk",
    "reading-edge",
    "snake",
    "snake-chunk",
    "snake-edge",
    "source-fragment",
    "source-sentence",
  ]),
};

export async function validateChapterJobInputFile(
  kind: ChapterJobKind,
  file: JobFile,
): Promise<void> {
  let optionCount = 0;
  for await (const record of readChapterJobInput(file)) {
    if (!allowedTypes[kind].has(record.type)) {
      throw new Error(`${record.type} is not valid input for ${kind}.`);
    }
    if (record.type === "job-options") {
      optionCount += 1;
      if (optionCount > 1) {
        throw new Error(
          `${kind} input contains more than one job-options record.`,
        );
      }
    }
  }
}
