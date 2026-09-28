import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  executeChapterJobFile,
  readChapterJobInput,
} from "wiki-graph-job";
import { describe, expect, it } from "vitest";

import {
  NodeDirectory,
  NodeFile,
} from "../../../../cli/src/runtime/node-platform.js";
import { DirectoryDocument } from "../../document/index.js";
import { applyChapterJobArtifactFile } from "./job-file-apply.js";
import { writeChapterJobInputFile } from "./job-file-snapshot.js";

describe("chapter job input files", () => {
  it("streams source sentences into an embedding input JSONL", async () => {
    const path = await mkdtemp(join(tmpdir(), "wiki-graph-job-input-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        const chapterId = await document.openSession(async (openedDocument) => {
          const id = await openedDocument.createSerial();
          await openedDocument
            .getSerialFragments(id)
            .writeTextStream("Alpha beta. Gamma delta.");
          return id;
        });
        const inputPath = join(path, "input.jsonl");
        await writeFile(inputPath, "");
        const revision = await writeChapterJobInputFile(
          document,
          chapterId,
          "index-embedding-source",
          new NodeFile(inputPath),
        );

        const records = await collect(
          readChapterJobInput(new NodeFile(inputPath)),
        );
        expect(revision).toBeGreaterThanOrEqual(0);
        expect(records).toEqual([
          {
            sentenceIndex: 0,
            text: "Alpha beta.",
            type: "source-sentence",
            wordsCount: 2,
          },
          {
            sentenceIndex: 1,
            text: "Gamma delta.",
            type: "source-sentence",
            wordsCount: 2,
          },
        ]);
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("applies a file-based FTS artifact without collecting it in the adapter", async () => {
    const path = await mkdtemp(join(tmpdir(), "wiki-graph-job-fts-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        const chapterId = await document.openSession(async (openedDocument) => {
          const id = await openedDocument.createSerial();
          await openedDocument
            .getSerialFragments(id)
            .writeTextStream("Alpha beta. Gamma delta.");
          return id;
        });
        const inputPath = join(path, "input.jsonl");
        const workspacePath = join(path, "workspace");
        await writeFile(inputPath, "");
        await mkdir(workspacePath);
        const revision = await writeChapterJobInputFile(
          document,
          chapterId,
          "index-fts",
          new NodeFile(inputPath),
        );
        const result = await executeChapterJobFile({
          inputFile: new NodeFile(inputPath),
          kind: "index-fts",
          revision,
          workspace: new NodeDirectory(workspacePath),
        });

        await document.openSession(
          async (openedDocument) =>
            await applyChapterJobArtifactFile(
              openedDocument,
              chapterId,
              "index-fts",
              revision,
              result.artifactFile,
            ),
        );

        const rows = await document.indexArtifacts.listLexicalRows(chapterId);
        expect(rows.map((row) => row.objectKind)).toEqual([
          "source-sentence",
          "source-sentence",
        ]);
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });
});

async function collect<T>(records: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const record of records) output.push(record);
  return output;
}
