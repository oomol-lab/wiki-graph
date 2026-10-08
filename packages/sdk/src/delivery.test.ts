import {
  access,
  link,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  addChapter,
  DirectoryDocument,
  replaceChapterFtsIndexArtifact,
  setChapterSource,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "wiki-graph-core";

import { createWikiGraphSDK } from "./sdk.js";
import { type WikiGraphJobSnapshot } from "./jobs.js";
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
  it("exposes archive titles as concrete optional objects", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-title-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    await sdk.archives.create({ path: "book.wikg" });
    const archive = await sdk.archives.open(standalone("book.wikg"));

    await expect(archive.page("wikg://")).rejects.toThrow("scope URI");
    await expect(archive.page("wikg://title")).rejects.toThrow("is missing");
    await archive.setArchiveTitle("  SDK Archive Title  ");
    await expect(archive.page("wikg://title")).resolves.toMatchObject({
      id: "wikg://title",
      title: "SDK Archive Title",
      type: "archive-title",
    });
    await expect(archive.list({ types: ["archive"] })).resolves.toMatchObject({
      items: [expect.objectContaining({ type: "archive-title" })],
    });

    await archive.putMetadata("", "title", "Metadata Title");
    await expect(archive.page("wikg://title")).resolves.toMatchObject({
      title: "Metadata Title",
    });
    await archive.deleteMetadata("", "title");
    await expect(archive.page("wikg://title")).rejects.toThrow("is missing");
    sdk.close();
  });

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
    const archive = await sdk.archives.open(standalone("book.wikg"));
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
      await (await sdk.archives.open(standalone("book.wikg"))).listChapters(),
    ).toHaveLength(1);
    expect(
      (await readdir(root)).filter((name) => name.includes("tmp.wikg")),
    ).toEqual([]);

    await sdk.archives.create({ path: "book.wikg", replace: true });
    expect(
      await (await sdk.archives.open(standalone("book.wikg"))).listChapters(),
    ).toEqual([]);

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

  it("reports detailed archive capability facts through the SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-inspect-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    await createEmptyArchive(
      join(root, "book.wikg"),
      root,
      "Inspectable source text.",
    );
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    const archive = await sdk.archives.open(standalone("book.wikg"));

    const report = await archive.inspect();
    expect(report.archiveUri).toContain("book.wikg");
    expect(report).toMatchObject({
      chapters: [
        {
          capabilities: {
            knowledgeGraph: { completed: false },
            readingGraph: { completed: false },
            readingSummary: { completed: false },
          },
          chapter: { chapterId: 1 },
          indexes: {
            fts: { current: false, exists: false },
            sourceEmbedding: { current: false, exists: false },
            summaryEmbedding: { current: false, exists: false },
          },
        },
      ],
    });
    expect(report.chapters[0]?.chapter.path).toEqual(expect.any(String));
    expect(Number.isInteger(report.chapters[0]?.revision)).toBe(true);
    await expect(archive.inspect({ chapterId: 1 })).resolves.toMatchObject({
      scope: { chapterId: 1, type: "chapter" },
    });
    await expect(archive.inspect({ chapterId: 999 })).rejects.toThrow(
      "Chapter 999 does not exist",
    );
    sdk.close();
  });

  it("prepares related and evidence query indexes within scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-query-scope-"));
    temporaryDirectories.push(root);
    const archivePath = join(root, "book.wikg");
    await mkdir(join(root, "state"));
    const indexedChapter = await createMixedIndexArchive(archivePath, root);
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    const rootArchive = await sdk.archives.open(standalone("book.wikg"));
    const scopedArchive = await sdk.archives.open(
      standalone(archivePath, indexedChapter.uri),
    );

    const defaultRelated = await scopedArchive.related("wikg://entity/Q1");
    expect(defaultRelated.items.map((item) => item.id)).toEqual([
      "wikg://triple/Q1/inside/Q2",
    ]);
    await expect(
      scopedArchive.related("wikg://entity/Q1", { queryMode: "fts" }),
    ).rejects.toThrow("`queryMode` requires `query`");
    await expect(
      scopedArchive.evidence("wikg://entity/Q1", { queryMode: "fts" }),
    ).rejects.toThrow("`queryMode` requires `query`");
    const related = await scopedArchive.related("wikg://entity/Q1", {
      query: "alpha",
    });
    expect(related.items.map((item) => item.id)).toEqual([
      "wikg://triple/Q1/inside/Q2",
    ]);
    await expect(
      scopedArchive.related("wikg://entity/Q1", {
        query: "alpha",
        queryMode: "fts",
      }),
    ).resolves.toMatchObject({ items: [{ id: "wikg://triple/Q1/inside/Q2" }] });
    await expect(
      scopedArchive.related("wikg://entity/Q1", {
        query: "alpha",
        queryMode: "embedding",
      }),
    ).rejects.toThrow("Embedding query mode requires embeddings configuration");
    const firstEvidence = await scopedArchive.evidence("wikg://entity/Q1", {
      limit: 1,
    });
    expect(firstEvidence.items).toHaveLength(1);
    expect(firstEvidence.items[0]?.chapterId).toBe(indexedChapter.chapterId);
    expect(firstEvidence.nextCursor).not.toBeNull();
    const durableCursor = await sdk.continuations.create(
      {
        archiveKey: scopedArchive.archiveKey,
        archivePath: scopedArchive.path,
        chapters: [indexedChapter.chapterId],
        continuationKind: "evidence",
        format: "json",
        indexScope: scopedArchive.indexScope,
        order: "doc-asc",
        targetUri: "wikg://entity/Q1",
        types: null,
      },
      firstEvidence.nextCursor,
    );
    if (durableCursor === null) {
      throw new Error("Expected a scoped evidence continuation cursor.");
    }
    const nextEvidence = await sdk.continuations.next({
      cursor: durableCursor,
      limit: 1,
    });
    expect(nextEvidence.kind).toBe("evidence");
    if (nextEvidence.kind !== "evidence") {
      throw new Error("Expected an evidence continuation page.");
    }
    expect(nextEvidence.result.items).toHaveLength(1);
    expect(nextEvidence.result.items[0]?.chapterId).toBe(
      indexedChapter.chapterId,
    );
    expect(nextEvidence.result.nextCursor).toBeNull();
    await expect(
      rootArchive.evidence("wikg://entity/Q1", { query: "alpha" }),
    ).rejects.toThrow("need a current FTS artifact");
    const evidence = await rootArchive.evidence("wikg://entity/Q1", {
      query: "alpha",
      skipUnindexed: true,
    });
    expect(evidence.items).toHaveLength(1);
    expect(
      evidence.items.every(
        (item) => item.chapterId === indexedChapter.chapterId,
      ),
    ).toBe(true);
    await expect(
      scopedArchive.evidence("wikg://entity/Q1", {
        query: "alpha",
        queryMode: "fts",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ type: "source" })],
    });
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
    const archive = await sdk.archives.open(standalone("book.wikg"));

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
        archive: standalone("book.wikg"),
        chapterId: added.chapterId,
        target: "index-fts",
      }),
    ).rejects.toThrow("Set source before queueing");

    const sourced = await archive.setChapterSource(added.path, "Source text.");
    expect(sourced.stage).toBe("sourced");
    const plan = await sdk.jobs.planEnqueue({
      archive: standalone("book.wikg"),
      chapterId: added.chapterId,
      target: "index-fts",
    });
    expect(plan.ready).toHaveLength(1);
    const enqueueTarget = standalone("book.wikg");
    const result = await sdk.jobs.enqueue({
      archive: enqueueTarget,
      chapterId: added.chapterId,
      target: "index-fts",
    });
    expect(result.created).toHaveLength(1);
    (enqueueTarget as { path: string }).path = "changed.wikg";
    const expectedArchiveTarget = standalone(archivePath);
    expect(result.created[0]?.job.snapshot).toMatchObject({
      archive: expectedArchiveTarget,
      chapterId: added.chapterId,
      target: "index-fts",
    });
    const createdJob = result.created[0]!.job;
    expect((await sdk.jobs.get(createdJob.id)).snapshot.archive).toEqual(
      expectedArchiveTarget,
    );
    expect(
      (await sdk.jobs.list({ all: true })).find(
        (job) => job.id === createdJob.id,
      )?.snapshot.archive,
    ).toEqual(expectedArchiveTarget);
    await result.created[0]!.job.cancel();
    expect(await sdk.jobs.clean()).toEqual(expect.any(Number));

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
    const archive = await sdk.archives.open(standalone("book.wikg"));
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
      sdk.continuations.next({ archive: standalone("other.wikg"), cursor }),
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
      const archive = await sdk.archives.open(standalone(`${name}.wikg`));
      await archive.addChapter({
        title: name,
      });
      await archive.setArchiveTitle(name);
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
        libraryQuery: "archive-members",
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

  it("keeps managed archive identity logical across handles, jobs, and continuations", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-identity-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    const library = await sdk.libraries.create("library");

    await expect(
      sdk.archives.create({ path: join("library", "unscanned.wikg") }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });

    await sdk.archives.create({ path: "source.wikg" });
    const member = await sdk.libraries.addArchive({
      inputPath: "source.wikg",
      target: library.uri,
      to: "book.wikg",
    });
    const physicalPath = join(root, "library", "book.wikg");
    await expect(
      sdk.archives.open(standalone(physicalPath)),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    await expect(
      sdk.maintenance.upgrade({ kind: "archive", path: physicalPath }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    await writeFile(join(root, "source.txt"), "Replacement source");
    await expect(
      sdk.conversions.convert({
        input: { format: "txt", path: "source.txt" },
        output: { format: "wikg", path: physicalPath },
        targetStage: "sourced",
      }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    await expect(
      sdk.conversions.convert({
        input: { format: "wikg", path: physicalPath },
        output: { format: "txt", path: "export.txt" },
      }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });

    const archive = await sdk.archives.open({
      kind: "library",
      uri: member.uri,
    });
    expect(archive.target).toEqual({ kind: "library", uri: member.uri });
    expect(archive.locatedUri).toBe(member.uri);
    expect(archive.path).toBe(member.uri);
    expect(JSON.stringify(member)).not.toContain(physicalPath);

    const chapter = await archive.addChapter({ source: "Managed source." });
    const secondChapter = await archive.addChapter({
      source: "Second managed source.",
    });

    const linkedLibrary = await sdk.libraries.create("linked-library");
    const linkedMemberPath = join(root, "linked-library", "linked.wikg");
    await link(physicalPath, linkedMemberPath);
    const linkedScan = await linkedLibrary.scan();
    expect(linkedScan.archives).toHaveLength(1);
    expect(linkedScan.archives[0]?.uri).not.toBe(member.uri);

    const aliasPath = join(root, "managed-alias.wikg");
    await link(physicalPath, aliasPath);
    const [physicalIdentity, linkedIdentity, aliasIdentity] = await Promise.all(
      [stat(physicalPath), stat(linkedMemberPath), stat(aliasPath)],
    );
    expect([linkedIdentity.dev, linkedIdentity.ino]).toEqual([
      physicalIdentity.dev,
      physicalIdentity.ino,
    ]);
    expect([aliasIdentity.dev, aliasIdentity.ino]).toEqual([
      physicalIdentity.dev,
      physicalIdentity.ino,
    ]);
    await expect(
      sdk.archives.open(standalone(aliasPath)),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    await expect(sdk.archives.open(standalone(aliasPath))).rejects.toThrow(
      "ambiguous",
    );

    const job = await sdk.jobs.create({
      archive: archive.target,
      chapterId: chapter.chapterId,
      target: "index-fts",
    });
    const expectedTarget = { kind: "library", uri: member.uri } as const;
    const expectManagedSnapshot = (snapshot: WikiGraphJobSnapshot): void => {
      expect(snapshot.archive).toEqual(expectedTarget);
      expect(snapshot.archiveKey).toBe(member.uri);
      expect(JSON.stringify(snapshot)).not.toContain(physicalPath);
    };
    expectManagedSnapshot(job.snapshot);
    expectManagedSnapshot((await sdk.jobs.get(job.id)).snapshot);
    const listedJob = (await sdk.jobs.list({ all: true })).find(
      (candidate) => candidate.id === job.id,
    );
    expect(listedJob).toBeDefined();
    expectManagedSnapshot(listedJob!.snapshot);

    const enqueued = await sdk.jobs.enqueue({
      archive: archive.target,
      chapterId: secondChapter.chapterId,
      target: "index-fts",
    });
    expect(enqueued.created).toHaveLength(1);
    const enqueuedJob = enqueued.created[0]!.job;
    expectManagedSnapshot(enqueuedJob.snapshot);
    expectManagedSnapshot((await sdk.jobs.get(enqueuedJob.id)).snapshot);
    const listedEnqueuedJob = (await sdk.jobs.list({ all: true })).find(
      (candidate) => candidate.id === enqueuedJob.id,
    );
    expect(listedEnqueuedJob).toBeDefined();
    expectManagedSnapshot(listedEnqueuedJob!.snapshot);

    const first = await archive.list({ limit: 1, types: ["chapter-title"] });
    if (!("nextCursor" in first) || first.nextCursor === null) {
      await Promise.all([job.cancel(), enqueuedJob.cancel()]);
      sdk.close();
      return;
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
    if (cursor !== null) {
      await expect(
        sdk.continuations.next({
          archive: { kind: "library", uri: member.uri },
          cursor,
        }),
      ).resolves.toMatchObject({ kind: "collection" });
    }
    await Promise.all([job.cancel(), enqueuedJob.cancel()]);
    sdk.close();
  }, 15_000);

  it("never falls back from a missing library membership URI to a path", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "wiki-graph-sdk-missing-member-"),
    );
    temporaryDirectories.push(root);
    await mkdir(join(root, "state"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    await sdk.libraries.create("library");
    await expect(
      sdk.archives.open({
        kind: "library",
        uri: "wikg://lib/arc/deadbeefcafe",
      }),
    ).rejects.toThrow();
    sdk.close();
  });
});

async function createEmptyArchive(
  path: string,
  root: string,
  source?: string,
): Promise<void> {
  const sourceDirectory = new NodeDirectory(join(root, "source"));
  await mkdir(sourceDirectory.path);
  const document = await DirectoryDocument.open(sourceDirectory);
  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
    });
    if (source !== undefined) {
      const chapter = await addChapter(document, { title: "Inspect me" });
      await setChapterSource(document, chapter.chapterId, [source]);
    }
  } finally {
    await document.release();
  }
  await writeWikgArchive(sourceDirectory, new NodeFile(path));
}

async function createMixedIndexArchive(
  path: string,
  root: string,
): Promise<{ readonly chapterId: number; readonly uri: string }> {
  const sourceDirectory = new NodeDirectory(join(root, "mixed-source"));
  await mkdir(sourceDirectory.path);
  const document = await DirectoryDocument.open(sourceDirectory);
  let indexedChapter!: { readonly chapterId: number; readonly uri: string };
  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
    });
    indexedChapter = await addChapter(document, { title: "Indexed" });
    await setChapterSource(document, indexedChapter.chapterId, [
      "Alpha is available for retrieval.",
    ]);
    const unindexedChapter = await addChapter(document, { title: "Unindexed" });
    await setChapterSource(document, unindexedChapter.chapterId, [
      "Beta remains unindexed.",
    ]);
    await document.openSession(async (openedDocument) => {
      await openedDocument.mentions.saveMany([
        {
          chapterId: indexedChapter.chapterId,
          id: "indexed-q1-a",
          qid: "Q1",
          rangeEnd: 5,
          rangeStart: 0,
          sentenceIndex: 0,
          surface: "Alpha",
        },
        {
          chapterId: indexedChapter.chapterId,
          id: "indexed-q1-b",
          qid: "Q1",
          rangeEnd: 18,
          rangeStart: 13,
          sentenceIndex: 0,
          surface: "Alpha",
        },
        {
          chapterId: indexedChapter.chapterId,
          id: "indexed-q2",
          qid: "Q2",
          rangeEnd: 32,
          rangeStart: 21,
          sentenceIndex: 0,
          surface: "retrieval",
        },
        {
          chapterId: unindexedChapter.chapterId,
          id: "unindexed-q1",
          qid: "Q1",
          rangeEnd: 4,
          rangeStart: 0,
          sentenceIndex: 0,
          surface: "Beta",
        },
        {
          chapterId: unindexedChapter.chapterId,
          id: "unindexed-q3",
          qid: "Q3",
          rangeEnd: 22,
          rangeStart: 15,
          sentenceIndex: 0,
          surface: "unindexed",
        },
      ]);
      await openedDocument.mentionLinks.saveMany([
        {
          evidenceSentenceIds: [[indexedChapter.chapterId, 0]],
          id: "indexed-link",
          predicate: "inside",
          sourceMentionId: "indexed-q1-a",
          targetMentionId: "indexed-q2",
        },
        {
          evidenceSentenceIds: [[unindexedChapter.chapterId, 0]],
          id: "unindexed-link",
          predicate: "outside",
          sourceMentionId: "unindexed-q1",
          targetMentionId: "unindexed-q3",
        },
      ]);
    });
    await replaceChapterFtsIndexArtifact(document, indexedChapter.chapterId);
  } finally {
    await document.release();
  }
  await writeWikgArchive(sourceDirectory, new NodeFile(path));
  return indexedChapter;
}

function standalone(path: string, objectUri?: string) {
  return {
    kind: "standalone" as const,
    path,
    ...(objectUri === undefined ? {} : { objectUri }),
  };
}
