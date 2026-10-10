import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";
import {
  replaceChapterFtsIndexArtifact,
  replaceChapterSourceEmbeddingIndexArtifact,
  WikiGraphArchiveFile,
  type ArchiveFindHit,
  type SearchIndexEmbeddingProvider,
  type SearchIndexQueryMode,
} from "wiki-graph-core";

import { createWikiGraphSDK, NodeFile, type WikiGraphSDK } from "./index.js";

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
      expect(first.buckets[0]!.nextCursor).not.toBeNull();
      expect(first.buckets[1]!.nextCursor).not.toBeNull();

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

async function createIndexedLibrary(): Promise<{
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
      (_, index) => `Needle record ${index} remains independently searchable.`,
    ).join(" "),
    title: "Pagination source",
  });
  await sdk.run(async () => {
    await new WikiGraphArchiveFile(new NodeFile(archivePath)).write(
      async (document) => {
        await replaceChapterFtsIndexArtifact(document, chapter.chapterId);
        await replaceChapterSourceEmbeddingIndexArtifact(
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
  return { embeddingProbe, libraryUri: library.uri, sdk };
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
