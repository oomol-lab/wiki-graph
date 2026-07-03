import { createHash } from "crypto";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import { extractWikgArchive } from "../../src/wikg/archive.js";
import { findArchiveObjects } from "../../src/archive/query/archive-view.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { SpineDigestFile } from "../../src/wikg/spine-digest-file.js";
import { WikgCoordinator } from "../../src/wikg/wikg-coordinator.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.WIKIGRAPH_STATE_DIR;

describe("wikg/spine-digest-file", () => {
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

  it("materializes custom read directories from coordinator state", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        const coordinator = new WikgCoordinator();
        const fileStore = coordinator.createFileStore(archivePath);

        try {
          await fileStore.writeFile(
            `${archivePath}/book-meta.json`,
            `${JSON.stringify({
              authors: [],
              description: null,
              identifier: "urn:test:overlay",
              language: "en",
              publishedAt: null,
              publisher: null,
              sourceFormat: "txt",
              title: "Overlay Directory Title",
              version: 1,
            })}\n`,
            { overwrite: true },
          );
        } finally {
          await fileStore.close();
        }

        await new SpineDigestFile(archivePath).read(
          async (digest) => {
            expect(await digest.readMeta()).toMatchObject({
              title: "Overlay Directory Title",
            });
          },
          {
            documentDirPath: `${path}/opened-read`,
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps read-only sqlite materialization as coordinator cache", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).read(async (digest) => {
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

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([
          expect.objectContaining({
            archivePath,
            entryPath: "database.db",
            kind: "file",
          }),
        ]);

        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Flushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps sqlite cache when write sessions only read the database", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new SpineDigestFile(archivePath).write(async (document) => {
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
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new SpineDigestFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new SpineDigestFile(archivePath).write(async (document) => {
          await document.createSerial();
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await new SpineDigestFile(archivePath).readDocument(
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

  it("settles failed archive writes when leaving the archive session", async () => {
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

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([
          expect.objectContaining({
            archivePath,
            entryPath: "database.db",
            kind: "file",
          }),
        ]);
        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Unflushed Title",
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

  it("reaps stale owner file overlays through a later archive session", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await seedStalePublishedFileOverlay({
          archivePath,
          entryPath: "book-meta.json",
          ownerId: "stale-owner-file",
          stateRootPath: `${path}/state`,
          workspacePath: `${path}/state/workspaces/stale/book-meta.json`,
          content: `${JSON.stringify({
            authors: [],
            description: null,
            identifier: "urn:test:reaped-file",
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "Reaped File Title",
            version: 1,
          })}\n`,
        });

        await new SpineDigestFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Reaped File Title",
          });
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Reaped File Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("reaps stale owner delete overlays through a later archive session", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await seedStalePublishedDeleteOverlay({
          archivePath,
          entryPath: "book-meta.json",
          ownerId: "stale-owner-delete",
          stateRootPath: `${path}/state`,
        });

        await new SpineDigestFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toBeUndefined();
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await expect(
          readArchivedEntry(archivePath, "book-meta.json"),
        ).resolves.toBeUndefined();
      } finally {
        restoreStateDir();
      }
    });
  });

  it("does not reaper unpublished staging files into the archive", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        const stagingPath = `${path}/state/workspaces/stale/book-meta.json.tmp`;

        await initializeCoordinatorState(archivePath);
        await mkdir(`${path}/state/workspaces/stale`, { recursive: true });
        await writeFile(
          stagingPath,
          `${JSON.stringify({
            title: "Unpublished Staging Title",
            version: 1,
          })}\n`,
          "utf8",
        );
        await insertStaleArchiveOwner({
          archivePath,
          ownerId: "stale-owner-staging",
        });

        await new SpineDigestFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Session Fixture",
          });
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
          "Session Fixture",
        );
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

async function readArchivedEntry(
  archivePath: string,
  entryPath: string,
): Promise<Uint8Array | undefined> {
  const { readWikgArchiveEntry } = await import("../../src/wikg/archive.js");

  return await readWikgArchiveEntry(archivePath, entryPath);
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

async function initializeCoordinatorState(archivePath: string): Promise<void> {
  await new WikgCoordinator().withArchiveSession(archivePath, () => {
    return undefined;
  });
}

async function seedStalePublishedFileOverlay(input: {
  readonly archivePath: string;
  readonly entryPath: string;
  readonly ownerId: string;
  readonly stateRootPath: string;
  readonly workspacePath: string;
  readonly content: string;
}): Promise<void> {
  await initializeCoordinatorState(input.archivePath);
  await mkdir(`${input.stateRootPath}/workspaces/stale`, { recursive: true });
  await writeFile(input.workspacePath, input.content, "utf8");
  await insertStaleArchiveOwner({
    archivePath: input.archivePath,
    ownerId: input.ownerId,
  });
  await insertEntryOverlay({
    archivePath: input.archivePath,
    entryPath: input.entryPath,
    kind: "file",
    workspacePath: input.workspacePath,
  });
}

async function seedStalePublishedDeleteOverlay(input: {
  readonly archivePath: string;
  readonly entryPath: string;
  readonly ownerId: string;
  readonly stateRootPath: string;
}): Promise<void> {
  await initializeCoordinatorState(input.archivePath);
  await mkdir(`${input.stateRootPath}/workspaces/stale`, { recursive: true });
  await insertStaleArchiveOwner({
    archivePath: input.archivePath,
    ownerId: input.ownerId,
  });
  await insertEntryOverlay({
    archivePath: input.archivePath,
    entryPath: input.entryPath,
    kind: "deleted",
  });
}

async function insertStaleArchiveOwner(input: {
  readonly archivePath: string;
  readonly ownerId: string;
}): Promise<void> {
  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(resolveCoordinatorDatabasePath());

  try {
    await database.run(
      `
INSERT INTO archive_owners (
  archive_key, owner_id, owner_pid, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
      [createArchiveKey(input.archivePath), input.ownerId, 1, 0, 0],
    );
  } finally {
    await database.close();
  }
}

async function insertEntryOverlay(input: {
  readonly archivePath: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly workspacePath?: string;
}): Promise<void> {
  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(resolveCoordinatorDatabasePath());

  try {
    await database.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
      [
        createArchiveKey(input.archivePath),
        input.archivePath,
        input.entryPath,
        input.kind,
        input.workspacePath ?? null,
        Date.now(),
      ],
    );
  } finally {
    await database.close();
  }
}

function resolveCoordinatorDatabasePath(): string {
  const stateDir = process.env.WIKIGRAPH_STATE_DIR;

  if (stateDir === undefined) {
    throw new Error("WIKIGRAPH_STATE_DIR is not set.");
  }

  return `${stateDir}/wikg-coordinator.sqlite`;
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
