import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";
import {
  replaceChapterFtsIndexArtifact,
  replaceChapterSourceEmbeddingIndexArtifact,
  replaceChapterSummaryEmbeddingIndexArtifact,
  WikiGraphArchiveFile,
  type ArchiveFindHit,
  type SearchIndexEmbeddingProvider,
  type SearchIndexQueryMode,
} from "wiki-graph-core";

import { createWikiGraphSDK, NodeFile, type WikiGraphSDK } from "../index.js";

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

describe("WikiGraphLibraryManager search pagination", () => {
  it("keeps raw signals on SDK archive summaries and query evidence, including previews and next pages", async () => {
    const setup = await createIndexedLibrary(true);
    try {
      const archive = await setup.sdk.archives.open({
        kind: "standalone",
        path: setup.archivePath,
      });
      await archive.ensureSearchIndex();
      setup.embeddingProbe.reset();
      const sourceFirst = await archive.search("needle", {
        types: ["source"],
        queryMode: "hybrid",
        sourceContext: 0,
        limit: 1,
      });
      const sourceCursor = sourceFirst.nextCursor();
      expect(sourceCursor).not.toBeNull();
      const sourceNext = await sourceCursor!.next({ limit: 1 });
      for (const hit of [...sourceFirst.items, ...sourceNext.items]) {
        expect(hit.ftsScore).toBeLessThan(0);
        expect(hit.embeddingScore).toBeGreaterThan(0);
      }
      // Archive text continuations already query once per page; raw fields add no calls.
      expect(setup.embeddingProbe.queryCount).toBe(2);
      await sourceCursor!.release();
      const summary = await archive.search("needle", {
        types: ["summary"],
        queryMode: "hybrid",
        sourceContext: 0,
      });
      expect(summary.items[0]?.type).toBe("summary");
      expect(summary.items[0]?.ftsScore).toBeLessThan(0);
      expect(summary.items[0]?.embeddingScore).toBeGreaterThan(0);
      const summaryVector = [1, "Needle summary sentence.".length / 100];
      const queryVector = [1, "needle".length / 100];
      const cosine =
        (summaryVector[0]! * queryVector[0]! +
          summaryVector[1]! * queryVector[1]!) /
        (Math.hypot(...summaryVector) * Math.hypot(...queryVector));
      expect(summary.items[0]?.embeddingScore).toBeCloseTo(cosine, 6);
      for (const mode of ["fts", "hybrid"] as const) {
        const first = await archive.evidence("wikg://entity/Q1", {
          query: "needle",
          queryMode: mode,
          sourceContext: 0,
          limit: 1,
        });
        expect(first.items[0]?.ftsScore).toBeLessThan(0);
        if (mode === "hybrid")
          expect(first.items[0]?.embeddingScore).toBeGreaterThan(0);
        else expect(first.items[0]?.embeddingScore).toBeUndefined();
        const cursor = first.nextCursor();
        expect(cursor).not.toBeNull();
        const second = await cursor!.next();
        expect(second.items[0]?.ftsScore).toBeLessThan(0);
        await cursor!.release();
      }
      const search = await archive.search("needle", {
        queryMode: "hybrid",
        sourceContext: 0,
        evidenceLimit: 2,
      });
      const entity = search.items.find(
        (hit) => hit.type === "entity" && hit.id.endsWith("/Q1"),
      );
      expect(entity).toBeDefined();
      expect(entity?.ftsScore).toBeUndefined();
      expect(entity?.embeddingScore).toBeUndefined();
      expect(entity?.evidence?.sources[0]?.ftsScore).toBeLessThan(0);
      expect(entity?.evidence?.sources[0]?.embeddingScore).toBeGreaterThan(0);
      const lexical = await archive.search("needle", {
        types: ["entity", "source", "triple"],
        queryMode: "fts",
        sourceContext: 0,
        evidenceLimit: 2,
      });
      for (const type of ["entity", "triple"] as const) {
        const hit = lexical.items.find((hit) => hit.type === type);
        expect(hit?.evidence?.sources[0]?.ftsScore).toBeLessThan(0);
        expect(hit?.evidence?.sources[0]?.embeddingScore).toBeUndefined();
      }
      const tripleEvidence = await archive.evidence(
        "wikg://triple/Q1/relates/Q2",
        { query: "needle", queryMode: "hybrid", sourceContext: 0 },
      );
      expect(tripleEvidence.items.length).toBeGreaterThan(0);
      expect(
        tripleEvidence.items.every(
          (hit) =>
            hit.ftsScore !== undefined && hit.embeddingScore !== undefined,
        ),
      ).toBe(true);
      const ordinary = await archive.evidence("wikg://entity/Q1", {
        sourceContext: 0,
      });
      expect(
        ordinary.items.every(
          (hit) =>
            hit.ftsScore === undefined && hit.embeddingScore === undefined,
        ),
      ).toBe(true);
      const libraryEvidence = await setup.sdk.libraries.evidence(
        setup.libraryUri,
        "wikg://entity/Q1",
        { query: "needle", queryMode: "hybrid", sourceContext: 0, limit: 1 },
      );
      expect(libraryEvidence.items[0]?.ftsScore).toBeLessThan(0);
      expect(libraryEvidence.items[0]?.embeddingScore).toBeGreaterThan(0);
    } finally {
      setup.sdk.close();
    }
  });
  it("shares one query build while bucket cursors advance independently", async () => {
    const setup = await createIndexedLibrary();

    try {
      setup.embeddingProbe.reset();
      const first = await setup.sdk.libraries.searchBuckets(
        setup.libraryUri,
        "needle",
        {
          buckets: [
            { id: "text-a", types: ["source"] },
            { id: "text-b", types: ["source"] },
          ],
          limitPerBucket: 5,
          queryMode: "hybrid",
        },
      );
      expect(setup.embeddingProbe.queryCount).toBe(1);
      expect(first.buckets).toHaveLength(2);
      expect(ids(first.buckets[0]!.items)).toEqual(
        ids(first.buckets[1]!.items),
      );
      expect(first.buckets[0]!.rawNextCursor).not.toBeNull();
      expect(first.buckets[1]!.rawNextCursor).not.toBeNull();

      const pageA = await setup.sdk.libraries.continueSearchBucket(
        setup.libraryUri,
        first.buckets[0]!.rawNextCursor!,
        { limit: 5 },
      );
      const pageB = await setup.sdk.libraries.continueSearchBucket(
        setup.libraryUri,
        first.buckets[1]!.rawNextCursor!,
        { limit: 5 },
      );
      expect(pageA.id).toBe("text-a");
      expect(pageB.id).toBe("text-b");
      expect(ids(pageA.items)).toEqual(ids(pageB.items));
      expect(setup.embeddingProbe.queryCount).toBe(1);
    } finally {
      setup.sdk.close();
    }
  });

  it.each(["fts", "embedding", "hybrid"] as const)(
    "paginates a real aggregate index in %s mode",
    async (queryMode) => {
      const setup = await createIndexedLibrary();

      try {
        const first = await search(setup.sdk, setup.libraryUri, queryMode, 20);
        expect(first.items).toHaveLength(20);
        expect(first.rawNextCursor).not.toBeNull();

        const second = await search(
          setup.sdk,
          setup.libraryUri,
          queryMode,
          20,
          first.rawNextCursor!,
        );
        expect(second.items.length).toBeGreaterThan(0);
        expect(second.rawNextCursor).not.toBe(first.rawNextCursor);

        const wider = await search(setup.sdk, setup.libraryUri, queryMode, 100);
        expect(ids([...first.items, ...second.items])).toEqual(
          ids(wider.items.slice(0, first.items.length + second.items.length)),
        );

        const paged = [...first.items, ...second.items];
        for (const hit of paged) {
          expect(hit.type).toBe("source");
          if (queryMode === "embedding") expect(hit.ftsScore).toBeUndefined();
          else expect(hit.ftsScore).toBeLessThan(0);
          if (queryMode === "fts") expect(hit.embeddingScore).toBeUndefined();
          else {
            expect(hit.embeddingScore).toBeGreaterThanOrEqual(-1);
            expect(hit.embeddingScore).toBeLessThanOrEqual(1);
          }
        }
        expect(paged).toEqual(wider.items.slice(0, paged.length));
        const seenCursors = new Set([
          first.rawNextCursor,
          second.rawNextCursor,
        ]);
        let cursor = second.rawNextCursor;
        while (cursor !== null) {
          const page = await search(
            setup.sdk,
            setup.libraryUri,
            queryMode,
            20,
            cursor,
          );
          expect(page.items.length).toBeGreaterThan(0);
          paged.push(...page.items);
          if (page.rawNextCursor !== null) {
            expect(seenCursors.has(page.rawNextCursor)).toBe(false);
            seenCursors.add(page.rawNextCursor);
          }
          cursor = page.rawNextCursor;
        }

        expect(new Set(ids(paged)).size).toBe(paged.length);
        expect(ids(paged)).toEqual(ids(wider.items));
      } finally {
        setup.sdk.close();
      }
    },
  );
});

async function createIndexedLibrary(interleaved = false): Promise<{
  readonly archivePath: string;
  readonly embeddingProbe: EmbeddingProbe;
  readonly libraryUri: string;
  readonly sdk: WikiGraphSDK;
}> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-pagination-"));
  temporaryDirectories.push(root);
  const embeddingProbe = createEmbeddingProvider();
  const provider = embeddingProbe.provider;
  const sdk = createWikiGraphSDK({
    providers: { embedding: provider },
    stateDir: join(root, "state"),
  });
  const archivePath = join(root, "source.wikg");
  await sdk.archives.create({ path: archivePath });
  const archive = await sdk.archives.open({
    kind: "standalone",
    path: archivePath,
  });
  const chapter = await archive.addChapter({
    source: Array.from(
      { length: 60 },
      (_, index) =>
        `Needle record ${index} remains independently searchable.${interleaved ? " Unrelated context." : ""}`,
    ).join(" "),
    title: "Pagination source",
  });
  await sdk.run(async () => {
    await new WikiGraphArchiveFile(new NodeFile(archivePath)).write(
      async (document) => {
        await document.openSession(async (opened) => {
          await opened.writeSummary(
            chapter.chapterId,
            "Needle summary sentence.",
          );
          await opened.mentions.saveMany(
            [0, 20].map((sentenceIndex) => ({
              chapterId: chapter.chapterId,
              id: `mention-${sentenceIndex}`,
              qid: "Q1",
              rangeStart: 0,
              rangeEnd: 6,
              sentenceIndex,
              surface: "Needle Example",
            })),
          );
          await opened.mentions.saveMany(
            [0, 20].map((sentenceIndex) => ({
              chapterId: chapter.chapterId,
              id: `target-${sentenceIndex}`,
              qid: "Q2",
              rangeStart: 7,
              rangeEnd: 13,
              sentenceIndex,
              surface: "Target",
            })),
          );
          await opened.mentionLinks.save({
            id: "relation",
            sourceMentionId: "mention-0",
            targetMentionId: "target-0",
            predicate: "relates",
            note: "Needle relation",
            evidenceSentenceIds: [
              [chapter.chapterId, 0],
              [chapter.chapterId, 20],
            ],
          });
        });
        await replaceChapterFtsIndexArtifact(document, chapter.chapterId);
        await replaceChapterSourceEmbeddingIndexArtifact(
          document,
          chapter.chapterId,
          provider,
        );
        await replaceChapterSummaryEmbeddingIndexArtifact(
          document,
          chapter.chapterId,
          provider,
        );
      },
    );
  });
  const library = await sdk.libraries.create(join(root, "library"));
  await sdk.libraries.addArchive({
    inputPath: archivePath,
    target: library.uri,
    to: "source.wikg",
  });
  await sdk.libraries.rebuildIndex(library.uri);
  return { archivePath, embeddingProbe, libraryUri: library.uri, sdk };
}

interface EmbeddingProbe {
  readonly provider: SearchIndexEmbeddingProvider;
  readonly queryCount: number;
  reset(): void;
}

function createEmbeddingProvider(): EmbeddingProbe {
  let queryCount = 0;
  return {
    provider: {
      dimensions: 3,
      identity: "pagination-test",
      model: "pagination-test",
      embedTexts: async (texts) => {
        await Promise.resolve();
        if (texts.length === 1 && texts[0]?.toLowerCase() === "needle") {
          queryCount += 1;
        }
        return {
          embeddings: texts.map((text, index) => [
            text.toLowerCase().includes("needle") ? 1 : 0,
            text.length / 100,
            index / Math.max(texts.length, 1),
          ]),
        };
      },
    },
    get queryCount() {
      return queryCount;
    },
    reset() {
      queryCount = 0;
    },
  };
}

async function search(
  sdk: WikiGraphSDK,
  libraryUri: string,
  queryMode: SearchIndexQueryMode,
  limit: number,
  cursor?: string,
) {
  return await sdk.libraries.search(libraryUri, "needle", {
    ...(cursor === undefined ? {} : { cursor }),
    limit,
    queryMode,
    types: ["source"],
  });
}

function ids(items: readonly ArchiveFindHit[]): readonly string[] {
  return items.map((item) => item.id);
}
