import { access, readFile } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import { extractSdpubArchive } from "../../src/facade/archive.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { SpineDigestFile } from "../../src/facade/spine-digest-file.js";
import { withTempDir } from "../helpers/temp.js";

const originalStateDir = process.env.SPINEDIGEST_STATE_DIR;
const originalFlushQuietPeriod = process.env.SPINEDIGEST_FLUSH_QUIET_PERIOD_MS;
const originalFlushIdleTimeout = process.env.SPINEDIGEST_FLUSH_IDLE_TIMEOUT_MS;

describe("facade/spine-digest-file", () => {
  afterEach(() => {
    restoreCoordinatorEnv();
  });

  it("opens a saved archive for reading and exposes digest operations", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
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
    });
  });

  it("keeps a custom extraction directory when one is provided", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
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
      useCoordinatorStateDir(`${path}/state`);
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
    });
  });

  it("opens the same archive concurrently without reinitializing sqlite schema", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
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
    });
  });

  it("flushes successful archive writes back to the archive", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
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
    });
  });

  it("keeps failed archive writes materialized without flushing", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
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

      expect(overlays.map((overlay) => overlay.entryPath).sort()).toStrictEqual(
        ["book-meta.json", "database.db"],
      );
      await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
        "Session Fixture",
      );
    });
  });

  it("reads materialized workspace state while flush is pending", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`, {
        idleTimeoutMs: 1_000,
        quietPeriodMs: 60_000,
      });
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
    });
  });

  it("runs concurrent writes to different archive entries", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`, {
        idleTimeoutMs: 1_000,
        quietPeriodMs: 60_000,
      });
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
    });
  });

  it("preserves a failed write overlay for later reads", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
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

    const archivePath = `${path}/fixture/book.sdpub`;

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

  await extractSdpubArchive(archivePath, extractPath);
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
    await access(`${path}/state/sdpub-coordinator.sqlite`);
  } catch {
    return [];
  }

  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(
    `${path}/state/sdpub-coordinator.sqlite`,
    "CREATE TABLE IF NOT EXISTS entry_overlays (archive_key TEXT, archive_path TEXT, entry_path TEXT, kind TEXT, workspace_path TEXT, updated_at INTEGER);",
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

function useCoordinatorStateDir(
  path: string,
  options: {
    readonly idleTimeoutMs?: number;
    readonly quietPeriodMs?: number;
  } = {},
): void {
  process.env.SPINEDIGEST_STATE_DIR = path;
  process.env.SPINEDIGEST_FLUSH_QUIET_PERIOD_MS = String(
    options.quietPeriodMs ?? 0,
  );
  process.env.SPINEDIGEST_FLUSH_IDLE_TIMEOUT_MS = String(
    options.idleTimeoutMs ?? 0,
  );
}

function restoreCoordinatorEnv(): void {
  restoreEnv("SPINEDIGEST_STATE_DIR", originalStateDir);
  restoreEnv("SPINEDIGEST_FLUSH_QUIET_PERIOD_MS", originalFlushQuietPeriod);
  restoreEnv("SPINEDIGEST_FLUSH_IDLE_TIMEOUT_MS", originalFlushIdleTimeout);
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
