import { access, mkdir, mkdtemp, readdir, rm } from "fs/promises";
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
  it("creates, rejects, atomically replaces, and cleans failed archive writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-create-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });

    const created = await sdk.archives.create({ path: "book.wikg" });
    expect(created.path).toBe(join(root, "book.wikg"));
    await expect(access(created.path)).resolves.toBeUndefined();
    const archive = await sdk.archives.open("book.wikg");
    await archive.addChapter({ source: "Keep me.", title: "Existing" });
    await expect(
      sdk.archives.create({ path: "book.wikg" }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_EXISTS" });
    expect(await archive.listChapters()).toHaveLength(1);

    await expect(
      sdk.archives.create({
        importPath: "missing.epub",
        path: "book.wikg",
        replace: true,
      }),
    ).rejects.toThrow();
    expect(
      await (await sdk.archives.open("book.wikg")).listChapters(),
    ).toHaveLength(1);
    expect(
      (await readdir(root)).filter((name) => name.includes("tmp.wikg")),
    ).toEqual([]);

    await sdk.archives.create({ path: "book.wikg", replace: true });
    expect(await (await sdk.archives.open("book.wikg")).listChapters()).toEqual(
      [],
    );

    await expect(
      sdk.archives.create({ importPath: "missing.epub", path: "failed.wikg" }),
    ).rejects.toThrow();
    await expect(access(join(root, "failed.wikg"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    sdk.close();
  });

  it("atomically rejects concurrent no-replace archive creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-create-race-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });

    for (let round = 0; round < 10; round += 1) {
      const path = `race-${round}.wikg`;
      const results = await Promise.allSettled([
        sdk.archives.create({ path }),
        sdk.archives.create({ path }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      const reason: unknown = rejected[0]?.reason;
      expect(reason).toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_EXISTS" });
    }

    expect(
      (await readdir(root)).filter((name) => name.includes("tmp.wikg")),
    ).toEqual([]);
    sdk.close();
  });

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

  it("restores and dispatches continuation cursors through the public SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-next-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    await sdk.archives.create({ path: "book.wikg" });
    const archive = await sdk.archives.open("book.wikg");
    for (const title of ["First", "Second", "Third", "Fourth"]) {
      await archive.addChapter({ title });
    }
    const first = await archive.list({ limit: 1, types: ["chapter-title"] });
    if (!("nextCursor" in first) || first.nextCursor === null) {
      throw new Error("Expected a collection continuation cursor.");
    }
    const cursor = await sdk.continuations.create(
      {
        archiveKey: archive.archiveKey,
        archivePath: archive.path,
        continuationKind: "collection",
        format: "json",
        indexScope: archive.indexScope,
        order: "doc-asc",
        types: ["chapter-title"],
      },
      first.nextCursor,
    );
    if (cursor === null) throw new Error("Expected a durable cursor.");

    const second = await sdk.continuations.next({ cursor, limit: 1 });
    expect(second).toMatchObject({ kind: "collection", limit: 1 });
    expect(second.result.items).toHaveLength(1);
    expect(second.result.nextCursor).toMatch(/^c_/u);
    const third = await sdk.continuations.next({
      cursor: second.result.nextCursor!,
      limit: 1,
    });
    expect(third.result.items).toHaveLength(1);
    expect(third.result.nextCursor).toMatch(/^c_/u);
    const fourth = await sdk.continuations.next({
      cursor: third.result.nextCursor!,
      limit: 1,
    });
    expect(fourth.result.items).toHaveLength(1);
    expect(fourth.result.nextCursor).toBeNull();
    await expect(
      sdk.continuations.next({ archive: "other.wikg", cursor }),
    ).rejects.toThrow("belongs to");
    sdk.close();
  });

  it("persists library-index continuation pages inside the SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-library-next-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    const library = await sdk.libraries.create("library");
    for (const name of ["one", "two", "three"]) {
      await sdk.archives.create({ path: `${name}.wikg` });
      await (
        await sdk.archives.open(`${name}.wikg`)
      ).addChapter({
        title: name,
      });
      await sdk.libraries.addArchive({
        inputPath: `${name}.wikg`,
        target: library.uri,
      });
    }
    const first = await sdk.libraries.archiveMembers(library.uri, { limit: 1 });
    if (first.nextCursor === null) {
      throw new Error("Expected a library collection cursor.");
    }
    const cursor = await sdk.continuations.create(
      {
        archiveKey: library.uri,
        archivePath: library.uri,
        continuationKind: "collection",
        format: "json",
        indexScope: {
          kind: "library-index",
          libraryId: library.snapshot.id,
        },
        order: "doc-asc",
        types: null,
      },
      first.nextCursor,
    );
    if (cursor === null) throw new Error("Expected a durable cursor.");

    const second = await sdk.continuations.next({ cursor, limit: 1 });
    expect(second.kind).toBe("collection");
    expect(second.result.items).toHaveLength(1);
    expect(second.result.nextCursor).toMatch(/^c_/u);
    const third = await sdk.continuations.next({
      cursor: second.result.nextCursor!,
      limit: 1,
    });
    expect(third.result.items).toHaveLength(1);
    expect(third.result.nextCursor).toBeNull();
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
