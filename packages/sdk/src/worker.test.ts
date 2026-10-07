import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { readChapterJobInput } from "wiki-graph-job";
import { WikiGraphArchiveFile } from "wiki-graph-core";
import { afterEach, describe, expect, it } from "vitest";

import { NodeFile } from "./node-platform.js";
import { createWikiGraphSDK } from "./sdk.js";
import {
  applyWikiGraphJobArtifacts,
  extractWikiGraphJobSnapshots,
} from "./worker.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("Wiki Graph job snapshots", () => {
  it("extracts ordered snapshots in one archive operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-snapshots-"));
    temporaryDirectories.push(root);
    const wikgPath = join(root, "book.wikg");
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    await sdk.archives.create({ path: wikgPath });
    const archive = await sdk.archives.open({
      kind: "standalone",
      path: wikgPath,
    });
    const chapter = await archive.addChapter({
      source: "Alpha beta. Gamma delta.",
      title: "Chapter",
    });
    sdk.close();

    const sourcePath = join(root, "source.jsonl");
    const ftsPath = join(root, "fts.jsonl");
    const observed: string[] = [];
    const results = await extractWikiGraphJobSnapshots({
      onSnapshot: (snapshot) => {
        observed.push(snapshot.outputPath);
      },
      requests: [
        {
          chapterPath: chapter.path,
          kind: "index-embedding-source",
          outputPath: sourcePath,
        },
        {
          chapterPath: chapter.path,
          kind: "index-fts",
          outputPath: ftsPath,
        },
      ],
      stateDir: join(root, "worker-state"),
      wikgPath,
    });

    expect(results.map(({ kind }) => kind)).toEqual([
      "index-embedding-source",
      "index-fts",
    ]);
    expect(results.every(({ revision }) => Number.isInteger(revision))).toBe(
      true,
    );
    expect(results[0]!.revision).toBe(results[1]!.revision);
    expect(observed).toEqual([sourcePath, ftsPath]);
    expect(
      await collect(readChapterJobInput(new NodeFile(sourcePath))),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "source-sentence" }),
      ]),
    );
    expect(await collect(readChapterJobInput(new NodeFile(ftsPath)))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "chapter-title" }),
      ]),
    );
  });
});

describe("Wiki Graph job artifact delivery", () => {
  it("applies a lazy sequence of artifacts through one archive operation", async () => {
    const root = await createRoot();
    const wikgPath = join(root, "book.wikg");
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "setup"),
    });
    await sdk.archives.create({ path: wikgPath });
    const archive = await sdk.archives.open({
      kind: "standalone",
      path: wikgPath,
    });
    const first = await archive.addChapter({
      source: "Alpha.",
      title: "First",
    });
    const second = await archive.addChapter({
      source: "Beta.",
      title: "Second",
    });
    sdk.close();

    const firstArtifact = join(root, "first.jsonl");
    const secondArtifact = join(root, "second.jsonl");
    await writeLexicalArtifact(firstArtifact, "alpha");
    await writeLexicalArtifact(secondArtifact, "beta");
    const yielded: number[] = [];

    const result = await applyWikiGraphJobArtifacts({
      artifacts: (async function* () {
        await Promise.resolve();
        yielded.push(first.chapterId);
        yield {
          artifactPath: firstArtifact,
          chapterId: first.chapterId,
          kind: "index-fts" as const,
        };
        yielded.push(second.chapterId);
        yield {
          artifactPath: secondArtifact,
          chapterId: second.chapterId,
          kind: "index-fts" as const,
        };
      })(),
      stateDir: join(root, "apply-state"),
      wikgPath,
    });

    expect(result).toEqual({ applied: 2 });
    expect(yielded).toEqual([first.chapterId, second.chapterId]);
    await new WikiGraphArchiveFile(new NodeFile(wikgPath)).readDocument(
      async (document) => {
        expect(
          await document.indexArtifacts.listLexicalRows(first.chapterId),
        ).toEqual([expect.objectContaining({ text: "alpha" })]);
        expect(
          await document.indexArtifacts.listLexicalRows(second.chapterId),
        ).toEqual([expect.objectContaining({ text: "beta" })]);
      },
    );
  });

  it("applies artifacts against the current chapter revision", async () => {
    const root = await createRoot();
    const wikgPath = join(root, "book.wikg");
    const artifactPath = join(root, "artifact.jsonl");
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "setup"),
    });
    await sdk.archives.create({ path: wikgPath });
    const archive = await sdk.archives.open({
      kind: "standalone",
      path: wikgPath,
    });
    const chapter = await archive.addChapter({ source: "Alpha." });
    sdk.close();
    await writeLexicalArtifact(artifactPath, "alpha");
    let consumedLaterArtifact = false;

    await applyWikiGraphJobArtifacts({
      artifacts: (async function* () {
        await Promise.resolve();
        yield {
          artifactPath,
          chapterId: chapter.chapterId,
          kind: "index-fts" as const,
        };
        consumedLaterArtifact = true;
      })(),
      stateDir: join(root, "apply-state"),
      wikgPath,
    });
    expect(consumedLaterArtifact).toBe(true);
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-apply-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeLexicalArtifact(path: string, text: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      metadata: {},
      objectId: "0",
      objectKind: "source-sentence",
      rowId: "source-sentence:0",
      sentenceIndex: 0,
      text,
      tokens: [`le:${text}`],
      type: "lexical-row",
    })}\n`,
  );
}
