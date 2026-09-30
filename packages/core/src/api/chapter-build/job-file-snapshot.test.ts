import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  executeChapterJobFile,
  readChapterJobInput,
  writeChapterJobArtifact,
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
          await openedDocument.writeToc({
            items: [{ children: [], serialId: id, title: "Test chapter" }],
            version: 1,
          });
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
        expect(rows.map((row) => row.objectId)).toEqual([
          `${chapterId}:0`,
          `${chapterId}:1`,
        ]);
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("applies semantic Reading Graph and summary artifact records", async () => {
    const path = await mkdtemp(join(tmpdir(), "wiki-graph-job-graph-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        const chapterId = await document.openSession(async (openedDocument) => {
          const id = await openedDocument.createSerial();
          await openedDocument
            .getSerialFragments(id)
            .writeTextStream("Alpha beta. Gamma delta.");
          await openedDocument.writeToc({
            items: [{ children: [], serialId: id, title: "Test chapter" }],
            version: 1,
          });
          return id;
        });
        const revision = await document.serials.getRevision(chapterId);
        const graphPath = join(path, "graph-artifact.jsonl");
        await writeFile(graphPath, "");
        await writeChapterJobArtifact(new NodeFile(graphPath), [
          {
            prompt: "Extract the graph.",
            scope: "reading-graph",
            type: "job-parameter",
          },
          {
            content: "Alpha beta.",
            generation: 0,
            id: "chunk-1",
            label: "Alpha",
            sentenceIndex: 0,
            sentenceIndexes: [0],
            type: "reading-chunk",
            weight: 1,
            wordsCount: 2,
          },
          {
            endSentenceIndex: 1,
            groupId: 0,
            startSentenceIndex: 0,
            type: "fragment-group",
          },
          {
            firstLabel: "Alpha",
            groupId: 0,
            id: "snake-1",
            lastLabel: "Alpha",
            localSnakeId: 0,
            size: 1,
            type: "snake",
            weight: 1,
            wordsCount: 2,
          },
          {
            chunkId: "chunk-1",
            position: 0,
            snakeId: "snake-1",
            type: "snake-chunk",
          },
        ]);

        await applyChapterJobArtifactFile(
          document,
          chapterId,
          "reading-graph",
          revision,
          new NodeFile(graphPath),
        );
        expect(await document.chunks.listBySerial(chapterId)).toHaveLength(1);
        expect((await document.serials.getById(chapterId))?.topologyReady).toBe(
          true,
        );

        const summaryPath = join(path, "summary-artifact.jsonl");
        await writeFile(summaryPath, "");
        await writeChapterJobArtifact(new NodeFile(summaryPath), [
          { position: 0, text: "First part.", type: "summary-part" },
          { position: 1, text: "Second part.", type: "summary-part" },
        ]);
        await applyChapterJobArtifactFile(
          document,
          chapterId,
          "reading-summary",
          revision,
          new NodeFile(summaryPath),
        );
        expect(await document.readSummary(chapterId)).toBe(
          "First part.\n\nSecond part.",
        );
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("namespaces Knowledge Graph artifact ids by chapter", async () => {
    const path = await mkdtemp(join(tmpdir(), "wiki-graph-job-knowledge-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        const chapterIds = await document.openSession(
          async (openedDocument) => [
            await openedDocument.createSerial(),
            await openedDocument.createSerial(),
          ],
        );
        for (const chapterId of chapterIds) {
          const artifactPath = join(path, `knowledge-${chapterId}.jsonl`);
          await writeFile(artifactPath, "");
          await writeChapterJobArtifact(new NodeFile(artifactPath), [
            {
              prompt: "Recall entities.",
              scope: "knowledge-graph",
              type: "job-parameter",
            },
            {
              id: "mention-1",
              qid: "Q1",
              rangeEnd: 5,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "Alpha",
              type: "mention",
            },
            {
              id: "mention-2",
              qid: "Q2",
              rangeEnd: 10,
              rangeStart: 6,
              sentenceIndex: 0,
              surface: "Beta",
              type: "mention",
            },
            {
              evidenceSentenceIndexes: [0],
              id: "link-1",
              predicate: "related to",
              sourceMentionId: "mention-1",
              targetMentionId: "mention-2",
              type: "mention-link",
            },
          ]);
          await applyChapterJobArtifactFile(
            document,
            chapterId,
            "knowledge-graph",
            await document.serials.getRevision(chapterId),
            new NodeFile(artifactPath),
          );
        }

        expect(
          (await document.mentions.listAll()).map((mention) => mention.id),
        ).toEqual(["m1-1", "m1-2", "m2-1", "m2-2"]);
        expect(
          (await document.mentionLinks.listAll()).map((link) => link.id),
        ).toEqual(["l1-1", "l2-1"]);
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
