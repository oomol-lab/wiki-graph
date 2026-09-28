import { describe, expect, it } from "vitest";

import type { JobFile, JobFileReader, JobFileWriter } from "./platform.js";
import {
  readChapterJobArtifact,
  readChapterJobInput,
  writeChapterJobArtifact,
  writeChapterJobInput,
} from "./jsonl.js";

describe("chapter job JSONL files", () => {
  it("writes and incrementally reads input records", async () => {
    const file = new MemoryFile();
    const records = [
      { language: "en", type: "job-options" as const },
      {
        sentenceIndex: 0,
        text: "The answer is forty-two.",
        type: "source-sentence" as const,
        wordsCount: 5,
      },
    ];

    await writeChapterJobInput(file, records);

    await expect(collect(readChapterJobInput(file))).resolves.toEqual(records);
  });

  it("writes and incrementally reads artifact records", async () => {
    const file = new MemoryFile();
    const records = [
      {
        metadata: { tiers: { tier1: ["douglas"] } },
        objectId: "7",
        objectKind: "chapter-title",
        rowId: "chapter-title:7",
        text: "Douglas Adams",
        tokens: ["douglas", "adams"],
        type: "lexical-row" as const,
      },
      {
        position: 0,
        text: "A compact summary.",
        type: "summary-part" as const,
      },
    ];

    await writeChapterJobArtifact(file, records);

    await expect(collect(readChapterJobArtifact(file))).resolves.toEqual(
      records,
    );
  });
});

class MemoryFile implements JobFile {
  public readonly identity = "memory:file";
  public readonly kind = "file" as const;
  public readonly name = "memory.jsonl";
  #bytes = new Uint8Array();

  public async openReader(): Promise<JobFileReader> {
    const bytes = this.#bytes;
    return await Promise.resolve({
      size: bytes.byteLength,
      close() {
        return Promise.resolve();
      },
      read(offset, length) {
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    });
  }

  public async openWriter(): Promise<JobFileWriter> {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    return await Promise.resolve({
      abort() {
        chunks.length = 0;
        return Promise.resolve();
      },
      commit: () => {
        const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this.#bytes = bytes;
        return Promise.resolve();
      },
      write(data) {
        chunks.push(typeof data === "string" ? encoder.encode(data) : data);
        return Promise.resolve();
      },
      writeAt() {
        return Promise.reject(new Error("Not implemented by this test file."));
      },
    });
  }
}

async function collect<T>(records: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const record of records) output.push(record);
  return output;
}
