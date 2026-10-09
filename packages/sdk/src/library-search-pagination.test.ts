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
  it.each(["fts", "embedding", "hybrid"] as const)(
    "paginates a real aggregate index in %s mode",
    async (queryMode) => {
      const setup = await createIndexedLibrary();

      try {
        const first = await search(setup.sdk, setup.libraryUri, queryMode, 20);
        expect(first.items).toHaveLength(20);
        expect(first.nextCursor).not.toBeNull();

        const second = await search(
          setup.sdk,
          setup.libraryUri,
          queryMode,
          20,
          first.nextCursor!,
        );
        expect(second.items.length).toBeGreaterThan(0);
        expect(second.nextCursor).not.toBe(first.nextCursor);

        const wider = await search(setup.sdk, setup.libraryUri, queryMode, 100);
        expect(ids([...first.items, ...second.items])).toEqual(
          ids(wider.items.slice(0, first.items.length + second.items.length)),
        );

        const paged = [...first.items, ...second.items];
        const seenCursors = new Set([first.nextCursor, second.nextCursor]);
        let cursor = second.nextCursor;
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
          if (page.nextCursor !== null) {
            expect(seenCursors.has(page.nextCursor)).toBe(false);
            seenCursors.add(page.nextCursor);
          }
          cursor = page.nextCursor;
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
  readonly libraryUri: string;
  readonly sdk: WikiGraphSDK;
}> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-pagination-"));
  temporaryDirectories.push(root);
  const provider = createEmbeddingProvider();
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
  return { libraryUri: library.uri, sdk };
}

function createEmbeddingProvider(): SearchIndexEmbeddingProvider {
  return {
    dimensions: 3,
    identity: "pagination-test",
    model: "pagination-test",
    embedTexts: async (texts) => {
      await Promise.resolve();
      return {
        embeddings: texts.map((text, index) => [
          text.toLowerCase().includes("needle") ? 1 : 0,
          text.length / 100,
          index / Math.max(texts.length, 1),
        ]),
      };
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
