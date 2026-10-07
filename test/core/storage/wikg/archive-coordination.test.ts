import { fork, type ChildProcess } from "child_process";
import { mkdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import { withWikiGraphStorage } from "../../../../packages/core/src/runtime/platform/index.js";
import {
  readWikgArchiveEntry,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { WikgCoordinator } from "../../../../packages/core/src/storage/wikg/coordinator.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import {
  createNodeWikiGraphStorage,
  NodeDirectory,
  NodeFile,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

const workerPath = fileURLToPath(
  new URL("../../../helpers/archive-coordination-worker.ts", import.meta.url),
);
const workerErrors = new WeakMap<ChildProcess, string[]>();

describe("wikg cross-process coordination", () => {
  it("preserves disjoint writes when the later process commits last", async () => {
    await withFixture(async ({ archivePath, stateRoot, storage }) => {
      const metadata = spawnWorker(archivePath, stateRoot, "meta");
      await waitForMessage(metadata, "ready");
      const toc = spawnWorker(archivePath, stateRoot, "toc");
      await waitForMessage(toc, "ready");

      metadata.send({ type: "write" });
      toc.send({ type: "write" });
      await Promise.all([
        waitForMessage(metadata, "published"),
        waitForMessage(toc, "published"),
      ]);
      metadata.send({ type: "finish" });
      await waitForExit(metadata);
      toc.send({ type: "finish" });
      await waitForExit(toc);

      await withWikiGraphStorage(storage, async () => {
        await expect(
          readJsonEntry(archivePath, "cover/info.json"),
        ).resolves.toMatchObject({
          title: "Written by metadata worker",
        });
        await expect(
          readJsonEntry(archivePath, "toc.json"),
        ).resolves.toMatchObject({
          items: [{ title: "Written by TOC worker" }],
        });
      });
    });
  });

  it("reaps a published write after its process exits abruptly", async () => {
    await withFixture(async ({ archivePath, stateRoot, storage }) => {
      const writer = spawnWorker(archivePath, stateRoot, "meta");
      await waitForMessage(writer, "ready");
      writer.send({ type: "write" });
      await waitForMessage(writer, "published");
      writer.send({ type: "crash" });
      await waitForExit(writer);

      await withWikiGraphStorage(storage, async () => {
        await reapThroughCoordinator(archivePath);
        await expect(
          readJsonEntry(archivePath, "cover/info.json"),
        ).resolves.toMatchObject({
          title: "Written by metadata worker",
        });
      });
    });
  });

  it("does not recover an unpublished staging snapshot after a hard exit", async () => {
    await withFixture(async ({ archivePath, stateRoot, storage }) => {
      const writer = spawnWorker(archivePath, stateRoot, "staging");
      await waitForMessage(writer, "ready");
      writer.send({ type: "write" });
      await waitForMessage(writer, "staged");
      writer.send({ type: "crash" });
      await waitForExit(writer);

      await withWikiGraphStorage(storage, async () => {
        await reapThroughCoordinator(archivePath);
        await expect(
          readJsonEntry(archivePath, "toc.json"),
        ).resolves.toMatchObject({ items: [{ title: "Original" }] });
      });
    });
  });

  it("reaps a published delete without resurrecting the entry", async () => {
    await withFixture(async ({ archivePath, stateRoot, storage }) => {
      const writer = spawnWorker(archivePath, stateRoot, "delete-summary");
      await waitForMessage(writer, "ready");
      writer.send({ type: "write" });
      await waitForMessage(writer, "published");
      writer.send({ type: "crash" });
      await waitForExit(writer);

      await withWikiGraphStorage(storage, async () => {
        await reapThroughCoordinator(archivePath);
        await expect(
          readWikgArchiveEntry(
            new NodeFile(archivePath),
            "texts/summary/1.txt",
          ),
        ).resolves.toBeUndefined();
      });
    });
  });

  it("recovers a committed SQLite change and stale lease after a hard exit", async () => {
    await withFixture(async ({ archivePath, stateRoot }) => {
      const writer = spawnWorker(archivePath, stateRoot, "database");
      await waitForMessage(writer, "ready");
      writer.send({ type: "write" });
      await expect(waitForMessage(writer, "published")).resolves.toMatchObject({
        serialId: 2,
      });
      writer.send({ type: "crash" });
      await waitForExit(writer);

      await expect(
        new WikiGraphArchiveFile(new NodeFile(archivePath)).readDocument(
          async (document) => await document.serials.getById(2),
        ),
      ).resolves.toMatchObject({ id: 2 });
    });
  });

  it("does not replace a SQLite entry while another session is using it", async () => {
    await withFixture(async ({ archivePath }) => {
      const archive = new NodeFile(archivePath);
      const coordinator = new WikgCoordinator();
      await coordinator.withArchiveSession(archive, async (readerSession) => {
        const document = await DirectoryDocument.openFileStore(
          readerSession.createFileStore({ readonlyDatabase: true }),
        );
        let startDelete!: () => void;
        const deleteStarted = new Promise<void>((resolve) => {
          startDelete = resolve;
        });
        let deleted = false;
        const deletion = coordinator.withArchiveSession(
          archive,
          async (writerSession) => {
            startDelete();
            await writerSession.deleteEntry("database.db");
            deleted = true;
          },
        );

        await deleteStarted;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
        expect(deleted).toBe(false);
        await document.release();
        await deletion;
        expect(deleted).toBe(true);
      });
    });
  });

  it("blocks new archive sessions while an exclusive replacement is active", async () => {
    await withFixture(async ({ archivePath }) => {
      const archive = new NodeFile(archivePath);
      const coordinator = new WikgCoordinator();
      let releaseReplacement!: () => void;
      const replacementGate = new Promise<void>((resolve) => {
        releaseReplacement = resolve;
      });
      let replacementEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        replacementEntered = resolve;
      });
      const replacement = coordinator.withExclusiveArchiveReplacement(
        archive,
        async () => {
          replacementEntered();
          await replacementGate;
        },
      );
      await entered;

      let readerEntered = false;
      const reading = coordinator.withArchiveSession(archive, () => {
        readerEntered = true;
      });
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      expect(readerEntered).toBe(false);

      releaseReplacement();
      await replacement;
      await reading;
      expect(readerEntered).toBe(true);
    });
  });

  it("does not settle a foreign overlay while its owner can still roll back", async () => {
    await withFixture(async ({ archivePath }) => {
      const archive = new NodeFile(archivePath);
      const coordinator = new WikgCoordinator();
      let markPublished!: () => void;
      const published = new Promise<void>((resolve) => {
        markPublished = resolve;
      });
      let failWriter!: () => void;
      const failureGate = new Promise<void>((resolve) => {
        failWriter = resolve;
      });
      const writer = coordinator.withArchiveSession(
        archive,
        async (writerSession) => {
          await writerSession.writeEntry(
            "toc.json",
            `${JSON.stringify({ items: [{ children: [], key: "chapter", serialId: 1, title: "Should rollback" }], version: 1 })}\n`,
            { overwrite: true },
          );
          markPublished();
          await failureGate;
          throw new Error("rollback writer");
        },
      );
      await published;
      await coordinator.withArchiveSession(archive, async (readerSession) => {
        const content = await readerSession.readEntry("toc.json");
        if (content === undefined) throw new Error("Expected TOC overlay");
        expect(
          JSON.parse(new TextDecoder().decode(content)) as {
            items: Array<{ title: string }>;
          },
        ).toMatchObject({ items: [{ title: "Should rollback" }] });
      });
      await expect(
        readJsonEntry(archivePath, "toc.json"),
      ).resolves.toMatchObject({ items: [{ title: "Original" }] });

      failWriter();
      await expect(writer).rejects.toThrow("rollback writer");
      await expect(
        readJsonEntry(archivePath, "toc.json"),
      ).resolves.toMatchObject({ items: [{ title: "Original" }] });
    });
  });

  it("settles dirty state observed before the writer dies", async () => {
    await withFixture(async ({ archivePath, stateRoot, storage }) => {
      const writer = spawnWorker(archivePath, stateRoot, "meta");
      await waitForMessage(writer, "ready");
      writer.send({ type: "write" });
      await waitForMessage(writer, "published");

      const reader = spawnWorker(archivePath, stateRoot, "observe-meta");
      await expect(waitForMessage(reader, "observed")).resolves.toMatchObject({
        title: "Written by metadata worker",
      });
      writer.send({ type: "crash" });
      await waitForExit(writer);
      reader.send({ type: "finish" });
      await waitForExit(reader);

      await withWikiGraphStorage(storage, async () => {
        await expect(
          readJsonEntry(archivePath, "cover/info.json"),
        ).resolves.toMatchObject({
          title: "Written by metadata worker",
        });
      });
    });
  });
});

async function withFixture(
  operation: (input: {
    readonly archivePath: string;
    readonly stateRoot: string;
    readonly storage: ReturnType<typeof createNodeWikiGraphStorage>;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir("wikigraph-coordination-", async (root) => {
    const stateRoot = join(root, "state");
    const documentPath = join(root, "document");
    await mkdir(documentPath, { recursive: true });
    const storage = createNodeWikiGraphStorage(stateRoot);
    await withWikiGraphStorage(storage, async () => {
      const directory = new NodeDirectory(documentPath);
      const document = await DirectoryDocument.open(directory);
      try {
        await document.openSession(async (opened) => {
          await opened.createSerial();
          await opened.writeBookMeta(createMeta("Before"));
          await opened.writeSummary(1, "Summary before deletion");
          await opened.writeToc({
            items: [
              {
                children: [],
                key: "chapter",
                serialId: 1,
                title: "Original",
              },
            ],
            version: 1,
          });
        });
      } finally {
        await document.release();
      }
      const archivePath = join(root, "book.wikg");
      await writeWikgArchive(directory, new NodeFile(archivePath));
      await operation({ archivePath, stateRoot, storage });
    });
  });
}

function spawnWorker(
  archivePath: string,
  stateRoot: string,
  action: string,
): ChildProcess {
  const child = fork(workerPath, [archivePath, stateRoot, action], {
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  const errors: string[] = [];
  child.stderr?.on("data", (chunk) => errors.push(String(chunk)));
  workerErrors.set(child, errors);
  return child;
}

async function waitForMessage(
  child: ChildProcess,
  type: string,
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${type}: ${workerErrors.get(child)?.join("") ?? ""}`,
        ),
      );
    }, 5_000);
    const onMessage = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== type
      ) {
        return;
      }
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Archive coordination worker exited with ${String(code)} before ${type}: ${workerErrors.get(child)?.join("") ?? ""}`,
        ),
      );
    };
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    expect(child.exitCode).toBe(0);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for worker exit: ${workerErrors.get(child)?.join("") ?? ""}`,
        ),
      );
    }, 5_000);
    child.once("exit", (code) => {
      globalThis.clearTimeout(timeout);
      if (code === 0) resolve();
      else
        reject(new Error(`Archive coordination worker exited with ${code}.`));
    });
  });
}

function createMeta(title: string) {
  return {
    authors: [],
    description: null,
    identifier: null,
    language: null,
    publishedAt: null,
    publisher: null,
    sourceFormat: "txt" as const,
    title,
    version: 1 as const,
  };
}

async function readJsonEntry(
  archivePath: string,
  entryPath: string,
): Promise<unknown> {
  const content = await readWikgArchiveEntry(
    new NodeFile(archivePath),
    entryPath,
  );
  return content === undefined
    ? undefined
    : JSON.parse(new TextDecoder().decode(content));
}

async function reapThroughCoordinator(archivePath: string): Promise<void> {
  await new WikgCoordinator().withArchiveSession(
    new NodeFile(archivePath),
    () => Promise.resolve(),
  );
}
