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
      archive: { kind: "standalone", path: wikgPath },
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
      archive: { kind: "standalone", path: wikgPath },
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
    });
    expect(consumedLaterArtifact).toBe(true);
  });

  it("invalidates standalone query state when artifacts commit", async () => {
    const root = await createRoot();
    const stateDir = join(root, "state");
    const wikgPath = join(root, "book.wikg");
    const alphaArtifact = join(root, "alpha.jsonl");
    const betaArtifact = join(root, "beta.jsonl");
    const secondArtifact = join(root, "second.jsonl");
    const sdk = createWikiGraphSDK({ cwd: root, stateDir });
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
      source: "Second.",
      title: "Second",
    });
    await Promise.all([
      writeLexicalArtifact(alphaArtifact, "alpha"),
      writeLexicalArtifact(betaArtifact, "beta"),
      writeLexicalArtifact(secondArtifact, "second"),
    ]);

    await applyWikiGraphJobArtifacts({
      archive: archive.target,
      artifacts: artifactsForEntries([
        [first.chapterId, alphaArtifact],
        [second.chapterId, secondArtifact],
      ]),
      stateDir,
    });
    expect((await archive.search("alpha")).items).not.toHaveLength(0);
    const cursor = await createCollectionCursor(sdk, archive);

    await applyWikiGraphJobArtifacts({
      archive: archive.target,
      artifacts: artifactsFor(first.chapterId, betaArtifact),
      stateDir,
    });

    expect((await archive.search("alpha")).items).toEqual([]);
    expect((await archive.search("beta")).items).not.toHaveLength(0);
    await expect(sdk.continuations.next({ cursor })).rejects.toThrow(
      "was not found or has expired",
    );
    sdk.close();
  });

  it("coordinates managed artifact commits with membership and library indexes", async () => {
    const root = await createRoot();
    const stateDir = join(root, "state");
    const wikgPath = join(root, "source.wikg");
    const alphaArtifact = join(root, "alpha.jsonl");
    const betaArtifact = join(root, "beta.jsonl");
    const gammaArtifact = join(root, "gamma.jsonl");
    const secondArtifact = join(root, "second.jsonl");
    const sdk = createWikiGraphSDK({ cwd: root, stateDir });
    await sdk.archives.create({ path: wikgPath });
    const standalone = await sdk.archives.open({
      kind: "standalone",
      path: wikgPath,
    });
    const first = await standalone.addChapter({
      source: "Alpha.",
      title: "First",
    });
    const second = await standalone.addChapter({
      source: "Second.",
      title: "Second",
    });
    await Promise.all([
      writeLexicalArtifact(alphaArtifact, "alpha"),
      writeLexicalArtifact(betaArtifact, "beta"),
      writeLexicalArtifact(gammaArtifact, "gamma"),
      writeLexicalArtifact(secondArtifact, "second"),
    ]);
    await applyWikiGraphJobArtifacts({
      archive: standalone.target,
      artifacts: artifactsForEntries([
        [first.chapterId, alphaArtifact],
        [second.chapterId, secondArtifact],
      ]),
      stateDir,
    });

    const library = await sdk.libraries.create("library");
    const member = await sdk.libraries.addArchive({
      inputPath: wikgPath,
      target: library.uri,
      to: "book.wikg",
    });
    const archive = await sdk.archives.open({
      kind: "library",
      uri: member.uri,
    });
    await sdk.libraries.rebuildIndex(library.uri);
    expect(
      (await sdk.libraries.search(library.uri, "alpha")).items,
    ).not.toHaveLength(0);
    expect((await archive.search("alpha")).items).not.toHaveLength(0);
    const cursor = await createCollectionCursor(sdk, archive);
    const before = await sdk.libraries.getArchive(member.uri);

    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let artifactApplied!: () => void;
    const artifactWasApplied = new Promise<void>((resolve) => {
      artifactApplied = resolve;
    });
    const applying = applyWikiGraphJobArtifacts({
      archive: archive.target,
      artifacts: (async function* () {
        yield {
          artifactPath: betaArtifact,
          chapterId: first.chapterId,
          kind: "index-fts" as const,
        };
        artifactApplied();
        await commitGate;
      })(),
      stateDir,
    });
    await artifactWasApplied;
    let querySettled = false;
    const queryDuringCommit = sdk.libraries
      .search(library.uri, "alpha")
      .finally(() => {
        querySettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(querySettled).toBe(false);
    releaseCommit();
    await applying;
    expect((await queryDuringCommit).items).toEqual([]);

    const after = await sdk.libraries.getArchive(member.uri);
    expect(after.lastSeenMutationToken).not.toBe(before.lastSeenMutationToken);
    expect(after.lastSeenSize).toBeTypeOf("number");
    expect(after.lastSeenMtimeMs).toBeTypeOf("number");
    await expect(sdk.libraries.indexState(library.uri)).resolves.toMatchObject({
      status: "current",
    });
    expect((await sdk.libraries.search(library.uri, "alpha")).items).toEqual(
      [],
    );
    expect(
      (await sdk.libraries.search(library.uri, "beta")).items,
    ).not.toHaveLength(0);
    expect((await archive.search("alpha")).items).toEqual([]);
    await expect(sdk.continuations.next({ cursor })).rejects.toThrow(
      "was not found or has expired",
    );

    await expect(
      applyWikiGraphJobArtifacts({
        archive: archive.target,
        artifacts: (async function* () {
          yield* artifactsFor(first.chapterId, gammaArtifact);
          yield {
            artifactPath: join(root, "missing.jsonl"),
            chapterId: first.chapterId,
            kind: "index-fts" as const,
          };
        })(),
        stateDir,
      }),
    ).rejects.toThrow();
    const afterFailure = await sdk.libraries.getArchive(member.uri);
    expect(afterFailure.lastSeenMutationToken).toBe(
      after.lastSeenMutationToken,
    );
    await expect(sdk.libraries.indexState(library.uri)).resolves.toMatchObject({
      status: "current",
    });
    expect(
      (await sdk.libraries.search(library.uri, "beta")).items,
    ).not.toHaveLength(0);
    expect((await sdk.libraries.search(library.uri, "gamma")).items).toEqual(
      [],
    );
    sdk.close();
  }, 20_000);
});

function artifactsFor(
  chapterId: number,
  artifactPath: string,
): AsyncIterable<{
  readonly artifactPath: string;
  readonly chapterId: number;
  readonly kind: "index-fts";
}> {
  return (async function* () {
    await Promise.resolve();
    yield { artifactPath, chapterId, kind: "index-fts" as const };
  })();
}

function artifactsForEntries(
  entries: readonly (readonly [chapterId: number, artifactPath: string])[],
): AsyncIterable<{
  readonly artifactPath: string;
  readonly chapterId: number;
  readonly kind: "index-fts";
}> {
  return (async function* () {
    await Promise.resolve();
    for (const [chapterId, artifactPath] of entries) {
      yield { artifactPath, chapterId, kind: "index-fts" as const };
    }
  })();
}

async function createCollectionCursor(
  sdk: ReturnType<typeof createWikiGraphSDK>,
  archive: Awaited<
    ReturnType<ReturnType<typeof createWikiGraphSDK>["archives"]["open"]>
  >,
): Promise<string> {
  const page = await archive.list({ limit: 1, types: ["chapter-title"] });
  if (!("nextCursor" in page) || page.nextCursor === null) {
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
    page.nextCursor,
  );
  if (cursor === null)
    throw new Error("Expected a durable continuation cursor.");
  return cursor;
}

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
