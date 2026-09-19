import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "./index.js";
import { SEARCH_INDEX_VERSION } from "../../retrieval/search-index/search/types.js";

async function withDocument(
  operation: (document: DirectoryDocument, path: string) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-search-index-"));

  try {
    const document = await DirectoryDocument.open(path);

    try {
      await operation(document, path);
    } finally {
      await document.release();
    }
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

describe("DirectoryDocument search index cache", () => {
  it("preserves incompatible cache on readonly access", async () => {
    await withDocument(async (document, path) => {
      await writeIncompatibleCache(document);

      await expect(
        document.readSearchIndexDatabase(() => "unreachable"),
      ).rejects.toThrow("Search index cache is missing: index.db");
      await expect(stat(join(path, "index.db"))).resolves.toBeDefined();
    });
  });

  it("reinitializes incompatible cache on write", async () => {
    await withDocument(async (document) => {
      await writeIncompatibleCache(document);

      const version = await document.writeSearchIndexDatabase(
        async (database) =>
          await database.queryOne(
            `
              SELECT value
              FROM search_index_state
              WHERE key = 'version'
            `,
            undefined,
            (row) => String(row.value),
          ),
      );

      expect(version).toBeUndefined();
    });
  });

  it("serializes concurrent incompatible cache reads and writes", async () => {
    await withDocument(async (document, path) => {
      await writeIncompatibleCache(document);

      let releaseWriter!: () => void;
      let resolveWriterEntered!: () => void;
      const writerEntered = new Promise<void>((resolveEntered) => {
        resolveWriterEntered = resolveEntered;
      });
      const writer = document.writeSearchIndexDatabase(async (database) => {
        resolveWriterEntered();
        await new Promise<void>((resolveWriter) => {
          releaseWriter = resolveWriter;
        });
        await database.run(
          `
            INSERT OR REPLACE INTO search_index_state(key, value)
            VALUES ('version', ?), ('concurrent', 'writer')
          `,
          [SEARCH_INDEX_VERSION],
        );
      });
      void writer.catch(() => {
        resolveWriterEntered();
      });

      try {
        await writerEntered;
        const reader = document.readSearchIndexDatabase(async (database) => {
          const value = await database.queryOne(
            `
              SELECT value
              FROM search_index_state
              WHERE key = 'concurrent'
            `,
            undefined,
            (row) => String(row.value),
          );

          return value;
        });

        releaseWriter();

        await expect(reader).resolves.toBe("writer");
        await expect(writer).resolves.toBeUndefined();
        await expect(stat(join(path, "index.db"))).resolves.toBeDefined();
      } catch (error) {
        releaseWriter?.();
        await writer.catch(() => undefined);
        throw error;
      }
    });
  });
});

async function writeIncompatibleCache(
  document: DirectoryDocument,
): Promise<void> {
  await document.writeSearchIndexDatabase(async (database) => {
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', 'old')
      `,
    );
  });
}
