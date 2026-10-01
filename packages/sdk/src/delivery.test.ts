import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DirectoryDocument,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "wiki-graph-core";

import { createWikiGraphSDK } from "./sdk.js";
import { NodeDirectory, NodeFile } from "./node-platform.js";

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

describe("WikiGraphSDK delivery operations", () => {
  it("owns chapter, index, and queue planning semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-delivery-"));
    temporaryDirectories.push(root);
    const archivePath = join(root, "book.wikg");
    const stateDir = join(root, "state");
    await mkdir(stateDir);
    await createEmptyArchive(archivePath, root);
    const sdk = createWikiGraphSDK({ cwd: root, stateDir });
    const archive = await sdk.archives.open("book.wikg");

    const added = await archive.addChapter({ title: "Opening" });
    expect(
      (await archive.listChapters()).map((chapter) => chapter.title),
    ).toEqual(["Opening"]);
    await expect(archive.getChapter(added.path)).resolves.toMatchObject({
      chapterId: added.chapterId,
      stage: "planned",
    });
    await expect(archive.getSearchIndexStatus()).resolves.toMatchObject({
      current: false,
    });
    await expect(
      sdk.jobs.planEnqueue({
        archive: "book.wikg",
        chapterId: added.chapterId,
        target: "index-fts",
      }),
    ).rejects.toThrow("Set source before queueing");

    const sourced = await archive.setChapterSource(added.path, "Source text.");
    expect(sourced.stage).toBe("sourced");
    const plan = await sdk.jobs.planEnqueue({
      archive: "book.wikg",
      chapterId: added.chapterId,
      target: "index-fts",
    });
    expect(plan.ready).toHaveLength(1);
    const result = await sdk.jobs.enqueue({
      archive: "book.wikg",
      chapterId: added.chapterId,
      target: "index-fts",
    });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.job.snapshot).toMatchObject({
      chapterId: added.chapterId,
      target: "index-fts",
    });

    sdk.close();
  });
});

async function createEmptyArchive(path: string, root: string): Promise<void> {
  const sourceDirectory = new NodeDirectory(join(root, "source"));
  await mkdir(sourceDirectory.path);
  const document = await DirectoryDocument.open(sourceDirectory);
  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
    });
  } finally {
    await document.release();
  }
  await writeWikgArchive(sourceDirectory, new NodeFile(path));
}
