import { createHash } from "crypto";
import { access, mkdir, readFile, rename } from "fs/promises";
import { resolve } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import {
  findArchiveObjects,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/view.js";
import { isSearchIndexCurrent } from "../../../../packages/core/src/retrieval/search-index/index.js";
import { WikiGraphArchive } from "../../../../packages/core/src/api/wiki-graph-archive.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import { withTempDir } from "../../../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("wikg/wiki-graph-archive-file", () => {
  afterEach(() => {
    restoreCoordinatorEnv();
  });

  it("opens a saved archive for reading and exposes digest operations", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const document = await DirectoryDocument.open(`${path}/document`);

        try {
          await seedDocument(document);

          const archivePath = `${path}/fixture/book.wikg`;
          await new WikiGraphArchive(document, document.path).saveAs(
            archivePath,
          );

          const digestFile = new WikiGraphArchiveFile(archivePath);
          const exportedText = await digestFile.read(async (digest) => {
            const textPath = `${path}/exports/from-read.txt`;

            expect(await digest.readMeta()).toMatchObject({
              title: "Session Fixture",
            });
            expect(await digest.readToc()).toMatchObject({
              items: [
                {
                  title: "Recovered Chapter",
                  serialId: 1,
                },
              ],
            });

            await digest.exportText(textPath);
            return await readFile(textPath, "utf8");
          });

          expect(exportedText).toBe("Recovered Chapter\n\nRecovered summary\n");
        } finally {
          await document.release();
        }
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps a custom extraction directory when one is provided", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.wikg`;
        const readDir = `${path}/opened-read`;

        await new WikiGraphArchive(document, document.path).saveAs(archivePath);

        const digestFile = new WikiGraphArchiveFile(archivePath);
        await digestFile.read(
          async (digest) => {
            expect(await digest.readMeta()).toMatchObject({
              title: "Session Fixture",
            });
          },
          {
            documentDirPath: readDir,
          },
        );
      } finally {
        await document.release();
      }
    });
  });

  it("keeps read-only sqlite materialization as coordinator cache", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Session Fixture",
          });
        });

        const overlays = await readCoordinatorOverlays(path);

        expect(overlays).toHaveLength(1);
        expect(overlays[0]).toMatchObject({
          archivePath,
          entryPath: "database.db",
          kind: "file",
        });
        expect(overlays[0]?.workspacePath).toMatch(/\/database\.db$/u);
      } finally {
        restoreStateDir();
      }
    });
  });

  it("opens the same archive concurrently without reinitializing sqlite schema", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await Promise.all(
          Array.from(
            { length: 6 },
            async () =>
              await new WikiGraphArchiveFile(archivePath).read(
                async (digest) => {
                  expect(await digest.readMeta()).toMatchObject({
                    title: "Session Fixture",
                  });
                },
              ),
          ),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("flushes successful archive writes back to the archive", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Flushed Title",
          });
        });

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Flushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps sqlite cache when write sessions only read the database", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await expect(document.peekNextSerialId()).resolves.toBe(2);
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([
          expect.objectContaining({
            archivePath,
            entryPath: "database.db",
            kind: "file",
          }),
        ]);
      } finally {
        restoreStateDir();
      }
    });
  });

  it("flushes sqlite cache when write sessions mutate the database", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await document.createSerial();
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(3);
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("clears cached archive searches after successful writes", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "Fresh Cache Title", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({ items: [] });
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await document.replaceToc({
            items: [
              {
                children: [],
                serialId: 1,
                title: "Fresh Cache Title",
              },
            ],
            version: 1,
          });
        });
        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "Fresh Cache Title", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  id: "wikg://chapter/fresh-cache-title/title",
                }),
              ],
            });
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("adopts orphaned external FTS cache after moving an archive", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        const movedArchivePath = `${path}/moved/book.wikg`;

        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        const beforeOverlays = await readCoordinatorOverlays(path);
        const oldFtsOverlay = beforeOverlays.find(
          (overlay) => overlay.entryPath === "fts.db",
        );

        expect(oldFtsOverlay).toMatchObject({
          archivePath,
          entryPath: "fts.db",
          kind: "file",
        });
        expect(oldFtsOverlay?.workspacePath).toContain(
          createArchiveKey(archivePath),
        );

        await mkdir(`${path}/moved`, { recursive: true });
        await rename(archivePath, movedArchivePath);
        await new WikiGraphArchiveFile(movedArchivePath).readDocument(
          async (document) => {
            await expect(isSearchIndexCurrent(document)).resolves.toBe(true);
          },
        );

        const afterOverlays = await readCoordinatorOverlays(path);
        const newFtsOverlay = afterOverlays.find(
          (overlay) =>
            overlay.entryPath === "fts.db" &&
            overlay.archivePath === movedArchivePath,
        );

        expect(newFtsOverlay).toMatchObject({
          archivePath: movedArchivePath,
          entryPath: "fts.db",
          kind: "file",
        });
        expect(newFtsOverlay?.workspacePath).toContain(
          createArchiveKey(movedArchivePath),
        );
        await expect(access(oldFtsOverlay!.workspacePath!)).rejects.toThrow();
      } finally {
        restoreStateDir();
      }
    });
  });

  it("does not let unrelated stale overlays fail archive writes", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await createStaleOverlay(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Fresh Title",
          });
        });

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Fresh Title",
        );
        await expect(readCoordinatorOverlays(path)).resolves.not.toContainEqual(
          expect.objectContaining({
            archivePath: `${path}/missing/book.wikg`,
            entryPath: "database.db",
            kind: "file",
          }),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("settles failed archive writes when leaving the archive session", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Unflushed Title",
            });
            throw new Error("stop before flush");
          }),
        ).rejects.toThrow("stop before flush");

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Unflushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("reads materialized workspace state while flush is pending", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Workspace Title",
          });
        });

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Workspace Title",
          });
        });
        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Workspace Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("runs concurrent writes to different archive entries", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await Promise.all([
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Concurrent Title",
            });
          }),
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            await document.replaceToc({
              items: [
                {
                  children: [],
                  serialId: 1,
                  title: "Concurrent Chapter",
                },
              ],
              version: 1,
            });
          }),
        ]);

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Concurrent Title",
          });
          expect(await digest.readToc()).toMatchObject({
            items: [
              {
                title: "Concurrent Chapter",
              },
            ],
          });
        });
      } finally {
        restoreStateDir();
      }
    });
  });

  it("preserves a failed write overlay for later reads", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Failed Overlay Title",
            });
            throw new Error("keep overlay");
          }),
        ).rejects.toThrow("keep overlay");

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Failed Overlay Title",
          });
        });
      } finally {
        restoreStateDir();
      }
    });
  });
});

async function seedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    await openedDocument.writeBookMeta({
      authors: ["Ari Lantern"],
      description: null,
      identifier: "urn:test:wiki-graph-archive-file",
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "txt",
      title: "Session Fixture",
      version: 1,
    });
    await openedDocument.writeSummary(1, "Recovered summary");
    await openedDocument.writeToc({
      items: [
        {
          children: [],
          serialId: 1,
          title: "Recovered Chapter",
        },
      ],
      version: 1,
    });
  });
}

async function createSeedArchive(path: string): Promise<string> {
  const document = await DirectoryDocument.open(`${path}/document`);

  try {
    await seedDocument(document);
    await rebuildArchiveSearchIndex(document);

    const archivePath = `${path}/fixture/book.wikg`;

    await new WikiGraphArchive(document, document.path).saveAs(archivePath);
    return archivePath;
  } finally {
    await document.release();
  }
}

async function readArchivedTitle(archivePath: string): Promise<string | null> {
  const meta = await new WikiGraphArchiveFile(archivePath).read(
    async (digest) => await digest.readMeta(),
  );

  return meta?.title ?? null;
}

async function readCoordinatorOverlays(path: string): Promise<
  Array<{
    readonly archivePath: string;
    readonly entryPath: string;
    readonly kind: string;
    readonly workspacePath?: string;
  }>
> {
  try {
    await access(`${path}/state/staging/staging.sqlite`);
  } catch {
    return [];
  }

  const { Database } =
    await import("../../../../packages/core/src/document/index.js");
  const database = await Database.open(
    `${path}/state/staging/staging.sqlite`,
    "",
    { readonly: true },
  );

  try {
    return await database.queryAll(
      `
SELECT archive_path, entry_path, kind, workspace_path
FROM entry_overlays
ORDER BY archive_path, entry_path
`,
      undefined,
      (row) => ({
        archivePath: expectString(row.archive_path),
        entryPath: expectString(row.entry_path),
        kind: expectString(row.kind),
        ...expectOptionalStringProperty(row.workspace_path, "workspacePath"),
      }),
    );
  } finally {
    await database.close();
  }
}

async function createStaleOverlay(path: string): Promise<void> {
  const { Database } =
    await import("../../../../packages/core/src/document/index.js");

  await mkdir(`${path}/state/staging`, { recursive: true });
  const database = await Database.open(
    `${path}/state/staging/staging.sqlite`,
    `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
      [
        "missing-archive-key",
        `${path}/missing/book.wikg`,
        "database.db",
        "file",
        `${path}/missing/database.db`,
        Date.now(),
      ],
    );
  } finally {
    await database.close();
  }
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

function useCoordinatorStateDir(path: string): () => void {
  const previousStateDir = process.env.WIKIGRAPH_STATE_DIR;

  process.env.WIKIGRAPH_STATE_DIR = path;

  return () => {
    restoreEnv("WIKIGRAPH_STATE_DIR", previousStateDir);
  };
}

function restoreCoordinatorEnv(): void {
  restoreEnv("WIKIGRAPH_STATE_DIR", originalStateDir);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function expectString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Expected string.");
  }

  return value;
}

function expectOptionalStringProperty(
  value: unknown,
  key: "workspacePath",
): { readonly workspacePath?: string } {
  if (value === null || value === undefined) {
    return {};
  }

  return { [key]: expectString(value) };
}
