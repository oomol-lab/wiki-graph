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

  it("opens a saved archive in a temporary session and exposes digest operations", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
        const exportedText = await digestFile.openSession(async (digest) => {
          const textPath = `${path}/exports/from-session.txt`;

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
        const sessionDir = `${path}/opened-session`;

        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
        await digestFile.openSession(
          async (digest) => {
            expect(await digest.readMeta()).toMatchObject({
              title: "Session Fixture",
            });
          },
          {
            documentDirPath: sessionDir,
          },
        );

        await expect(
          access(`${sessionDir}/book-meta.json`),
        ).resolves.toBeUndefined();
        expect(
          await readFile(`${sessionDir}/book-meta.json`, "utf8"),
        ).toContain("Session Fixture");
      } finally {
        await document.release();
      }
    });
  });

  it("flushes successful editable sessions back to the archive", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
      const archivePath = await createSeedArchive(path);

      await new SpineDigestFile(archivePath).openEditableSession(
        async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Flushed Title",
          });
        },
      );

      await expect(readCoordinatorArchives(path)).resolves.toStrictEqual([]);

      await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
        "Flushed Title",
      );
    });
  });

  it("keeps failed editable sessions materialized without flushing", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`);
      const archivePath = await createSeedArchive(path);

      await expect(
        new SpineDigestFile(archivePath).openEditableSession(
          async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Unflushed Title",
            });
            throw new Error("stop before flush");
          },
        ),
      ).rejects.toThrow("stop before flush");

      const archives = await readCoordinatorArchives(path);

      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({
        dirty: 1,
        flushable: 0,
        operationPid: null,
      });
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

      await new SpineDigestFile(archivePath).openEditableSession(
        async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Workspace Title",
          });
        },
      );

      await new SpineDigestFile(archivePath).openSession(async (digest) => {
        expect(await digest.readMeta()).toMatchObject({
          title: "Workspace Title",
        });
      });
      await expect(readArchivedTitle(path, archivePath)).resolves.toBe(
        "Session Fixture",
      );
    });
  });

  it("rejects concurrent editable sessions for the same archive", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`, {
        idleTimeoutMs: 1_000,
        quietPeriodMs: 60_000,
      });
      const archivePath = await createSeedArchive(path);
      let markFirstSessionEntered!: () => void;
      let releaseFirstSession!: () => void;
      const firstSessionEntered = new Promise<void>((resolveEntered) => {
        markFirstSessionEntered = resolveEntered;
      });
      const releaseFirstSessionSignal = new Promise<void>((resolveRelease) => {
        releaseFirstSession = resolveRelease;
      });

      const firstSession = new SpineDigestFile(archivePath).openEditableSession(
        async () => {
          markFirstSessionEntered();
          await releaseFirstSessionSignal;
        },
      );

      await firstSessionEntered;
      await waitForCoordinatorArchive(path);
      await expect(
        new SpineDigestFile(archivePath).openEditableSession(async () => {}),
      ).rejects.toThrow("Archive is already being edited");

      releaseFirstSession();
      await firstSession;
    });
  });

  it("recovers stale editable sessions when the owner process is gone", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      useCoordinatorStateDir(`${path}/state`, {
        idleTimeoutMs: 1_000,
        quietPeriodMs: 60_000,
      });
      const archivePath = await createSeedArchive(path);

      await expect(
        new SpineDigestFile(archivePath).openEditableSession(
          async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Interrupted Title",
            });
            throw new Error("interrupted");
          },
        ),
      ).rejects.toThrow("interrupted");

      await setCoordinatorOperationPid(path, -1);
      await new SpineDigestFile(archivePath).openEditableSession(
        async (document) => {
          const meta = await document.readBookMeta();

          expect(meta).toMatchObject({
            title: "Interrupted Title",
          });
        },
      );
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

async function readCoordinatorArchives(path: string): Promise<
  Array<{
    readonly archivePath: string;
    readonly dirty: number;
    readonly flushable: number;
    readonly operationPid: number | null;
  }>
> {
  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(
    `${path}/state/state.sqlite`,
    "CREATE TABLE IF NOT EXISTS archives (archive_key TEXT);",
  );

  try {
    return await database.queryAll(
      `
SELECT archive_path, dirty, flushable, operation_pid
FROM archives
ORDER BY archive_path
`,
      undefined,
      (row) => ({
        archivePath: expectString(row.archive_path),
        dirty: expectNumber(row.dirty),
        flushable: expectNumber(row.flushable),
        operationPid:
          row.operation_pid === null ? null : expectNumber(row.operation_pid),
      }),
    );
  } finally {
    await database.close();
  }
}

async function waitForCoordinatorArchive(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await readCoordinatorArchives(path)).length > 0) {
      return;
    }

    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 10);
    });
  }

  throw new Error("Timed out waiting for coordinator archive state.");
}

async function setCoordinatorOperationPid(
  path: string,
  pid: number,
): Promise<void> {
  const { Database } = await import("../../src/document/index.js");
  const database = await Database.open(
    `${path}/state/state.sqlite`,
    "CREATE TABLE IF NOT EXISTS archives (archive_key TEXT);",
  );

  try {
    await database.run("UPDATE archives SET operation_pid = ?", [pid]);
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

function expectNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new TypeError("Expected number.");
  }

  return value;
}
