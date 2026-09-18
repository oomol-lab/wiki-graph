import { access } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  createNodeWikiGraphStorage,
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { DirectoryFileStore } from "../../../../packages/core/src/document/directory/directory-file-store.js";
import type {
  File,
  Directory,
  FileWriter,
  HostZipEntry,
} from "../../../../packages/core/src/runtime/platform/index.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("Node File/Directory adapter", () => {
  it("constructs storage capabilities without creating the home directory", async () => {
    await withTempDir("wikigraph-platform-storage-", async (path) => {
      const stateRoot = join(path, "not-created");
      const storage = createNodeWikiGraphStorage(stateRoot);

      expect(storage.library.identity).toBe(
        new NodeDirectory(stateRoot).identity,
      );
      expect(storage.documentStore.identity).toBe(
        new NodeDirectory(join(stateRoot, "documents")).identity,
      );
      await expect(access(stateRoot)).rejects.toThrow();
    });
  });

  it("performs relative child operations and transactional file writes", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      const directory = await root.createDirectory("documents");
      const file = await directory.createFile("chapter.txt");
      const writer = await file.openWriter();

      await writer.write("chapter ");
      await writer.write("one");
      await writer.commit();

      const stored = await directory.getFile("chapter.txt");
      expect(stored).toBeDefined();
      expect(stored!.name).toBe("chapter.txt");
      await expect(stored!.read({ encoding: "utf8" })).resolves.toBe(
        "chapter one",
      );
    });
  });

  it("reads byte ranges without materializing the whole file", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const file = new NodeFile(join(path, "range.txt"));
      const writer = await file.openWriter();
      await writer.write("alpha beta gamma");
      await writer.commit();

      const reader = await file.openReader();
      try {
        expect(reader.size).toBe(16);
        await expect(reader.read(6, 4)).resolves.toEqual(
          new TextEncoder().encode("beta"),
        );
        await expect(reader.read(16, 0)).resolves.toEqual(new Uint8Array());
        await expect(reader.read(15, 2)).rejects.toThrow("exceeds");
      } finally {
        await reader.close();
      }
      await expect(reader.read(0, 1)).rejects.toThrow("closed FileReader");
    });
  });

  it("supports positioned writes before transactional commit", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      const file = await root.createFile("positions.bin");
      const writer = await file.openWriter();

      await writer.writeAt(4, new Uint8Array([5, 6]));
      await writer.writeAt(1, new Uint8Array([2, 3, 4]));
      await expect(writer.writeAt(-1, new Uint8Array())).rejects.toThrow(
        "offset",
      );
      await writer.commit();

      expect(Array.from((await file.read()) as Uint8Array)).toEqual([
        0, 2, 3, 4, 5, 6,
      ]);
    });
  });

  it("aborts append when an existing file reader cannot open", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      const backing = await root.createFile("text.txt");
      const writer = await backing.openWriter();
      await writer.write("original");
      await writer.commit();
      const failingFile: File = {
        identity: backing.identity,
        name: backing.name,
        openReader: () => Promise.reject(new Error("reader unavailable")),
        openWriter: async () => await backing.openWriter(),
        read: async (options) => await backing.read(options),
      };
      const directory: Directory = {
        identity: root.identity,
        name: root.name,
        createDirectory: async (name) => await root.createDirectory(name),
        createFile: async (name) => await root.createFile(name),
        getDirectory: async (name) => await root.getDirectory(name),
        getFile: async (name) =>
          name === "text.txt" ? failingFile : await root.getFile(name),
        list: async () => await root.list(),
        remove: async (name, options) => await root.remove(name, options),
      };
      const store = new DirectoryFileStore(directory);

      await expect(
        store.appendFile("text.txt", new TextEncoder().encode(" appended")),
      ).rejects.toThrow("reader unavailable");
      await expect(backing.read({ encoding: "utf8" })).resolves.toBe(
        "original",
      );
    });
  });

  it("rejects absolute and parent-directory child names", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      await expect(root.getFile("../outside.txt")).rejects.toThrow(
        "relative name",
      );
      await expect(root.createDirectory("/tmp")).rejects.toThrow(
        "relative name",
      );
    });
  });

  it("uses a Directory root for document-relative files", async () => {
    await withTempDir("wikigraph-directory-store-", async (path) => {
      const store = new DirectoryFileStore(new NodeDirectory(path));
      await store.writeFile("texts/source/1", "hello", { overwrite: true });
      const value = await store.readFile("texts/source/1");
      expect(Array.from(value ?? [])).toEqual([104, 101, 108, 108, 111]);
      await expect(store.writeFile("texts/source/1", "again")).rejects.toThrow(
        "already exists",
      );
      await store.writeFile("texts/source/1", "again", { overwrite: true });
    });
  });

  it("provides database and ZIP services over opaque File values", async () => {
    await withTempDir("wikigraph-host-services-", async (path) => {
      const root = new NodeDirectory(path);
      const databaseFile = await root.createFile("host.sqlite");
      const database = await nodeWikiGraphPlatform.database.open(databaseFile);
      try {
        await database.execute("CREATE TABLE records (value TEXT NOT NULL)");
        await database.run("INSERT INTO records (value) VALUES (?)", ["ok"]);
        await expect(
          database.queryOne("SELECT value FROM records"),
        ).resolves.toMatchObject({ value: "ok" });
      } finally {
        await database.close();
      }

      const zipFile = await root.createFile("host.zip");
      await nodeWikiGraphPlatform.zip.write(zipFile, [
        { data: new TextEncoder().encode("alpha"), name: "a.txt" },
        { data: new TextEncoder().encode("beta"), name: "nested/b.txt" },
      ]);
      const reader = await nodeWikiGraphPlatform.zip.open(zipFile);
      const entries = await Promise.all(
        (await reader.listEntries()).map(async (name) => ({
          data: (await reader.readEntry(name)) as Uint8Array,
          name,
        })),
      );
      await reader.close();

      expect(
        entries.map((entry) => [
          entry.name,
          new TextDecoder().decode(entry.data),
        ]),
      ).toEqual([
        ["a.txt", "alpha"],
        ["nested/b.txt", "beta"],
      ]);
    });
  });

  it("streams ZIP output through sequential FileWriter chunks", async () => {
    const probe = createWriterProbe({ writeDelayMs: 1 });

    await nodeWikiGraphPlatform.zip.write(probe.file, createLargeZipEntries());

    expect(probe.writeCalls).toBeGreaterThan(1);
    expect(probe.maxConcurrentWrites).toBe(1);
    expect(probe.commitCalls).toBe(1);
    expect(probe.commitAtWriteCount).toBe(probe.writeCalls);
    expect(probe.abortCalls).toBe(0);
  });

  it("aborts a streaming ZIP write when a chunk fails", async () => {
    const probe = createWriterProbe({ failWriteAt: 2 });

    await expect(
      nodeWikiGraphPlatform.zip.write(probe.file, createLargeZipEntries()),
    ).rejects.toThrow("stream write failed");

    expect(probe.writeCalls).toBe(2);
    expect(probe.commitCalls).toBe(0);
    expect(probe.abortCalls).toBe(1);
  });

  it("rejects promptly when the sink fails while an async producer waits", async () => {
    const probe = createWriterProbe({ failWriteAt: 1 });
    let releaseProducer: (() => void) | undefined;
    let signalProducerWaiting: (() => void) | undefined;
    const producerWaiting = new Promise<void>((resolve) => {
      signalProducerWaiting = resolve;
    });
    const producerRelease = new Promise<void>((resolve) => {
      releaseProducer = resolve;
    });
    const entries = (async function* (): AsyncGenerator<HostZipEntry> {
      yield {
        data: new Uint8Array(256 * 1024).fill(1),
        name: "first.bin",
      };
      signalProducerWaiting?.();
      await producerRelease;
      yield {
        data: new Uint8Array(256 * 1024).fill(2),
        name: "second.bin",
      };
    })();
    const writing = nodeWikiGraphPlatform.zip.write(probe.file, entries);

    await producerWaiting;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          writing,
          new Promise<never>((_resolve, reject) => {
            timeout = globalThis.setTimeout(
              () => reject(new Error("stream failure was not propagated")),
              100,
            );
          }),
        ]),
      ).rejects.toThrow("stream write failed");
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      releaseProducer?.();
      await entries.return(undefined);
    }

    expect(probe.commitCalls).toBe(0);
    expect(probe.abortCalls).toBe(1);
  });

  it("aborts a streaming ZIP write when entry production fails", async () => {
    const probe = createWriterProbe();
    const entries = (function* (): Generator<HostZipEntry> {
      yield {
        data: new TextEncoder().encode("first"),
        name: "first.txt",
      };
      throw new Error("entry production failed");
    })();

    await expect(
      nodeWikiGraphPlatform.zip.write(probe.file, entries),
    ).rejects.toThrow("entry production failed");

    expect(probe.commitCalls).toBe(0);
    expect(probe.abortCalls).toBe(1);
  });

  it("aborts a streaming ZIP write when ZIP entry creation fails", async () => {
    const probe = createWriterProbe();

    await expect(
      nodeWikiGraphPlatform.zip.write(probe.file, [
        {
          data: new TextEncoder().encode("invalid"),
          name: "../invalid.txt",
        },
      ]),
    ).rejects.toThrow();

    expect(probe.commitCalls).toBe(0);
    expect(probe.abortCalls).toBe(1);
  });

  it("aborts a streaming ZIP write when commit fails", async () => {
    const probe = createWriterProbe({ failCommit: true });

    await expect(
      nodeWikiGraphPlatform.zip.write(probe.file, createLargeZipEntries()),
    ).rejects.toThrow("commit failed");

    expect(probe.commitCalls).toBe(1);
    expect(probe.abortCalls).toBe(1);
  });

  it("restores persisted opaque capabilities without exposing a path to Core", async () => {
    await withTempDir("wikigraph-host-resources-", async (path) => {
      const directory = new NodeDirectory(path);
      const file = await directory.createFile("archive.wikg");

      const restoredDirectory =
        await nodeWikiGraphPlatform.resources.getDirectory(directory.identity);
      const restoredFile = await nodeWikiGraphPlatform.resources.getFile(
        file.identity,
      );

      expect(restoredDirectory?.identity).toBe(directory.identity);
      expect(restoredFile?.identity).toBe(file.identity);
      expect(restoredDirectory).not.toHaveProperty("absolutePath");
      expect(restoredFile).not.toHaveProperty("absolutePath");
    });
  });
});

function createLargeZipEntries(): HostZipEntry[] {
  return Array.from({ length: 4 }, (_, index) => ({
    data: new Uint8Array(256 * 1024).fill(index + 1),
    name: `entry-${index}.bin`,
  }));
}

function createWriterProbe(
  options: {
    readonly failCommit?: boolean;
    readonly failWriteAt?: number;
    readonly writeDelayMs?: number;
  } = {},
): {
  readonly file: File;
  readonly abortCalls: number;
  readonly commitAtWriteCount: number | undefined;
  readonly commitCalls: number;
  readonly maxConcurrentWrites: number;
  readonly writeCalls: number;
} {
  let abortCalls = 0;
  let activeWrites = 0;
  let commitAtWriteCount: number | undefined;
  let commitCalls = 0;
  let maxConcurrentWrites = 0;
  let writeCalls = 0;
  const writer: FileWriter = {
    abort: () => {
      abortCalls += 1;
      return Promise.resolve();
    },
    commit: () => {
      commitCalls += 1;
      commitAtWriteCount = writeCalls;
      if (options.failCommit === true) {
        return Promise.reject(new Error("commit failed"));
      }
      return Promise.resolve();
    },
    write: async () => {
      writeCalls += 1;
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      try {
        if (writeCalls === options.failWriteAt) {
          throw new Error("stream write failed");
        }
        if ((options.writeDelayMs ?? 0) > 0) {
          await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, options.writeDelayMs);
          });
        }
      } finally {
        activeWrites -= 1;
      }
    },
    writeAt: () => Promise.resolve(),
  };
  const file: File = {
    identity: "writer-probe",
    name: "probe.zip",
    openReader: () => Promise.reject(new Error("not used")),
    openWriter: () => Promise.resolve(writer),
    read: () => Promise.resolve(new Uint8Array()),
  };
  return {
    get abortCalls() {
      return abortCalls;
    },
    get commitAtWriteCount() {
      return commitAtWriteCount;
    },
    get commitCalls() {
      return commitCalls;
    },
    file,
    get maxConcurrentWrites() {
      return maxConcurrentWrites;
    },
    get writeCalls() {
      return writeCalls;
    },
  };
}
