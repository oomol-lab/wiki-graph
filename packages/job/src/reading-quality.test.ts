import { expect, it } from "vitest";
import { executeChapterJobFile } from "./file-executor.js";
import { writeChapterJobInput } from "./jsonl.js";
import {
  MemoryJobDirectory,
  MemoryJobFile,
} from "./testing/memory-platform.js";

it("does not publish a reading graph when every extraction fell back", async () => {
  const inputFile = new MemoryJobFile("input.jsonl");
  await writeChapterJobInput(inputFile, [
    {
      type: "source-text",
      sentenceIndex: 0,
      text: "Alice visited London.",
      wordsCount: 4,
    },
  ]);
  const workspace = new MemoryJobDirectory();
  await expect(
    executeChapterJobFile({
      inputFile,
      kind: "reading-graph",
      revision: 1,
      workspace,
      llm: {
        request: () => Promise.resolve("Sorry, I cannot answer this request."),
      },
    }),
  ).rejects.toThrow("All Reading Graph extractions failed validation");
  expect(await workspace.list()).toEqual([]);
});
