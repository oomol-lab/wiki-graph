import { access, mkdir, readFile } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import { extractWikgArchive } from "../../src/facade/archive.js";
import { findArchiveObjects } from "../../src/facade/archive-view.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { SpineDigestFile } from "../../src/facade/spine-digest-file.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("facade/spine-digest-file", () => {
  afterEach(() => {
    restoreCoordinatorEnv();
  });

  it("opens a saved archive for reading and exposes digest operations", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const document = await DirectoryDocument.open(`${path}/document`);

        try {
          await seedDocument(document);

          const archivePath = `${path}/fixture/book.wikg`;
          await new SpineDigest(document, document.path).saveAs(archivePath);

          const digestFile = new SpineDigestFile(archivePath);
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
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.wikg`;
        const readDir = `${path}/opened-read`;

        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
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

        await expect(
          access(`${readDir}/book-meta.json`),
        ).resolves.toBeUndefined();
        expect(await readFile(`${readDir}/book-meta.json`, "utf8")).toContain(
          "Session Fixture",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("materializes sqlite state for plain archive reads", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Session Fixture",
          });
        });

        await expect(readCoordinatorOverlays(path)).resolves.toMatchObject([
          {
            entryPath: "database.db",
            kind: "file",
          },
        ]);
      } finally {
        restoreStateDir();
      }
    });
  });

  it("opens the same archive concurrently without reinitializing sqlite schema", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await Promise.all(
          Array.from(
            { length: 6 },
            async () =>
              await new SpineDigestFile(archivePath).read(async (digest) => {
                expect(await digest.readMeta()).toMatchObject({
                  title: "Session Fixture",
                });
              }),
          ),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("flushes successful archive writes back to the archive", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Flushed Title",
          });
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);

        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Flushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("clears cached archive searches after successful writes", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "Fresh Cache Title", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({ items: [] });
          },
        );

        await new SpineDigestFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Fresh Cache Title",
          });
        });

        await new SpineDigestFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "Fresh Cache Title", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({
              items: [expect.objectContaining({ id: "meta:root" })],
            });
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("does not let unrelated stale overlays fail archive writes", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await createStaleOverlay(path);

        await new SpineDigestFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Fresh Title",
          });
        });

        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Fresh Title",
        );
        await expect(readCoordinatorOverlays(path)).resolves.toContainEqual(
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

  it("keeps failed archive writes materialized without flushing", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new SpineDigestFile(archivePath).write(async (document) => {
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

        const overlays = await readCoordinatorOverlays(path);

        expect(
          overlays.map((overlay) => overlay.entryPath).sort(),
        ).toStrictEqual(["book-meta.json", "database.db"]);
        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Session Fixture",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("reads materialized workspace state while flush is pending", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Workspace Title",
          });
        });

        await new SpineDigestFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Workspace Title",
          });
        });
        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Workspace Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("runs concurrent writes to different archive entries", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await Promise.all([
          new SpineDigestFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Concurrent Title",
            });
          }),
          new SpineDigestFile(archivePath).write(async (document) => {
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

        await new SpineDigestFile(archivePath).read(async (digest) => {
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
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new SpineDigestFile(archivePath).write(async (document) => {
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

        await new SpineDigestFile(archivePath).read(async (digest) => {
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
      identifier: "urn:test:spine-digest-file",
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

    const archivePath = `${path}/fixture/book.wikg`;

    await new SpineDigest(document, document.path).saveAs(archivePath);
    return archivePath;
  } finally {
    await document.release();
  }
}

async function readArchivedTitle(
  path: string,
  archivePath: string,
): Promise<string | null> {
  const extractPath = `${path}/extract-${Math.random().toString(16).slice(2)}`;

  await extractWikgArchive(archivePath, extractPath);
  const meta = JSON.parse(
    await readFile(`${extractPath}/book-meta.json`, "utf8"),
  ) as { readonly title: string | null };

  return meta.title;
}

async function readCoordinatorOverlays(path: string): Promise<
  Array<{
    readonly archivePath: string;
    readonly entryPath: string;
    readonly kind: string;
  }>
> {
  try {
    await access(`${path}/state/wikg-coordinator.sqlite`);
  } catch {
    return [];
  }

  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(
    `${path}/state/wikg-coordinator.sqlite`,
    "",
    { readonly: true },
  );

  try {
    return await database.queryAll(
      `
SELECT archive_path, entry_path, kind
FROM entry_overlays
ORDER BY archive_path, entry_path
`,
      undefined,
      (row) => ({
        archivePath: expectString(row.archive_path),
        entryPath: expectString(row.entry_path),
        kind: expectString(row.kind),
      }),
    );
  } finally {
    await database.close();
  }
}

async function createStaleOverlay(path: string): Promise<void> {
  const { Database } = await import("../../src/document/index.js");

  await mkdir(`${path}/state`, { recursive: true });
  const database = await Database.open(
    `${path}/state/wikg-coordinator.sqlite`,
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
