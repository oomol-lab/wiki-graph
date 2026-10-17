import { access, readFile, rename } from "fs/promises";
import { spawnSync } from "child_process";
import * as yauzl from "yauzl";
import { join } from "path";
import { pathToFileURL } from "url";
import { describe, expect, it, vi } from "vitest";

import {
  createNodeWikiGraphStorage,
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
  writeNodeFileHandle,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { DirectoryFileStore } from "../../../../packages/core/src/document/directory/directory-file-store.js";
import type {
  File,
  Directory,
  FileWriter,
  HostZipEntry,
} from "../../../../packages/core/src/runtime/platform/index.js";
import {
  appendFileText,
  copyFileContent,
  readFileBytes,
  readFileText,
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
      await expect(readFileText(stored!)).resolves.toBe("chapter one");
    });
  });

  it("retries sequential writes until every byte is written", async () => {
    const written: number[] = [];
    const write = vi.fn(
      (buffer: Uint8Array, offset: number, length: number) => {
        const bytesWritten = Math.min(2, length);
        written.push(...buffer.subarray(offset, offset + bytesWritten));
        return Promise.resolve({ buffer, bytesWritten });
      },
    );

    await writeNodeFileHandle({ write } as never, "abcdef");

    expect(write).toHaveBeenCalledTimes(3);
    expect(new TextDecoder().decode(new Uint8Array(written))).toBe("abcdef");
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

      expect(Array.from(await readFileBytes(file))).toEqual([0, 2, 3, 4, 5, 6]);
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
        kind: "file",
        name: backing.name,
        openReader: () => Promise.reject(new Error("reader unavailable")),
        openWriter: async () => await backing.openWriter(),
      };
      const directory: Directory = {
        identity: root.identity,
        kind: "directory",
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
      await expect(readFileText(backing)).resolves.toBe("original");
    });
  });

  it("uses FileReader size when optional size metadata is absent", async () => {
    await withTempDir("wikigraph-platform-size-", async (path) => {
      const root = new NodeDirectory(path);
      const backing = await root.createFile("text.txt");
      const file: File = {
        identity: backing.identity,
        kind: "file",
        name: backing.name,
        openReader: async () => await backing.openReader(),
        openWriter: async () => await backing.openWriter(),
      };
      const directory: Directory = {
        identity: root.identity,
        kind: "directory",
        name: root.name,
        createDirectory: async (name) => await root.createDirectory(name),
        createFile: () => Promise.resolve(file),
        getDirectory: async (name) => await root.getDirectory(name),
        getFile: (name) =>
          Promise.resolve(name === "text.txt" ? file : undefined),
        list: () => Promise.resolve([file]),
        remove: async (name, options) => await root.remove(name, options),
      };
      const store = new DirectoryFileStore(directory);

      await store.appendFile("text.txt", new TextEncoder().encode("你好"));
      await store.appendFile("text.txt", new TextEncoder().encode(" world"));

      await expect(store.getFileSize("text.txt")).resolves.toBe(12);
      await expect(readFileText(backing)).resolves.toBe("你好 world");
    });
  });

  it("closes the source reader when the target writer cannot open", async () => {
    let closed = false;
    const source: File = {
      identity: "source",
      kind: "file",
      name: "source",
      openReader: () =>
        Promise.resolve({
          close: () => {
            closed = true;
            return Promise.resolve();
          },
          read: () => Promise.resolve(new Uint8Array()),
          size: 0,
        }),
      openWriter: () => Promise.reject(new Error("unused")),
    };
    const target: File = {
      identity: "target",
      kind: "file",
      name: "target",
      openReader: () => Promise.reject(new Error("unused")),
      openWriter: () => Promise.reject(new Error("writer unavailable")),
    };

    await expect(copyFileContent(source, target)).rejects.toThrow(
      "writer unavailable",
    );
    expect(closed).toBe(true);
  });

  it("appends multiple chunks to an existing file before replacing it", async () => {
    await withTempDir("wikigraph-append-", async (path) => {
      const file = new NodeFile(join(path, "events.ndjson"));
      const original = "first event\n".repeat(10000);
      await appendFileText(file, original);
      await appendFileText(file, "second event\n");
      await appendFileText(file, "third event\n");
      await expect(readFileText(file)).resolves.toBe(
        `${original}second event\nthird event\n`,
      );
    });
  });

  it("preserves the original when the append reader cannot close", async () => {
    await withTempDir("wikigraph-append-close-", async (path) => {
      const backing = new NodeFile(join(path, "events.ndjson"));
      await appendFileText(backing, "original\n");
      const file: File = {
        identity: backing.identity,
        kind: "file",
        name: backing.name,
        openWriter: async () => await backing.openWriter(),
        openReader: async () => {
          const reader = await backing.openReader();
          return {
            size: reader.size,
            read: async (offset, length) => await reader.read(offset, length),
            close: async () => {
              await reader.close();
              throw new Error("reader close failed");
            },
          };
        },
      };

      await expect(appendFileText(file, "next\n")).rejects.toThrow(
        "reader close failed",
      );
      await expect(readFileText(backing)).resolves.toBe("original\n");
      await expect(new NodeDirectory(path).list()).resolves.toHaveLength(1);
    });
  });

  it("closes the append reader when the writer cannot open", async () => {
    let closed = false;
    const file: File = {
      identity: "append",
      kind: "file",
      name: "append",
      openReader: () =>
        Promise.resolve({
          close: () => {
            closed = true;
            return Promise.resolve();
          },
          read: () => Promise.resolve(new Uint8Array()),
          size: 0,
        }),
      openWriter: () => Promise.reject(new Error("writer unavailable")),
    };

    await expect(appendFileText(file, "next")).rejects.toThrow(
      "writer unavailable",
    );
    expect(closed).toBe(true);
  });

  it("does not replace a file when its append reader fails", async () => {
    const openWriter = vi.fn<() => Promise<FileWriter>>();
    const file: File = {
      identity: "append-reader-failure",
      kind: "file",
      name: "events.jsonl",
      openReader: () => Promise.reject(new Error("remote read failed")),
      openWriter,
    };

    await expect(appendFileText(file, "next")).rejects.toThrow(
      "remote read failed",
    );
    expect(openWriter).not.toHaveBeenCalled();
  });

  it("appends to a new file after an explicit missing-file error", async () => {
    let committed = false;
    const write = vi.fn<(_: Uint8Array | string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const file: File = {
      identity: "new-append-file",
      kind: "file",
      name: "events.jsonl",
      openReader: () => Promise.reject(missing),
      openWriter: () =>
        Promise.resolve({
          abort: () => Promise.resolve(),
          commit: () => {
            committed = true;
            return Promise.resolve();
          },
          write,
          writeAt: () => Promise.resolve(),
        }),
    };

    await appendFileText(file, "next");

    expect(write).toHaveBeenCalledWith("next");
    expect(committed).toBe(true);
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
      const database = await nodeWikiGraphPlatform.database.open(databaseFile, {
        create: true,
        mode: "readwrite",
      });
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
      await expect(reader.getEntrySize("a.txt")).resolves.toBe(5);
      await expect(reader.getEntrySize("missing.txt")).resolves.toBeUndefined();
      await expect(reader.readEntryRange("a.txt", 1, 3)).resolves.toEqual(
        new TextEncoder().encode("lph"),
      );
      await expect(reader.readEntryRange("a.txt", 4, 2)).rejects.toThrow(
        "exceeds",
      );
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

  it("supports concurrent WAL readers through repeated opens", async () => {
    await withTempDir("wikigraph-wal-", async (path) => {
      const root = new NodeDirectory(join(path, "spaces # percent %"));
      const file = await root.createFile("state.sqlite");
      const database = await nodeWikiGraphPlatform.database.open(file, {
        create: true,
        mode: "readwrite",
      });
      try {
        await database.execute(
          "PRAGMA journal_mode = WAL; CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES (42)",
        );
      } finally {
        await database.close();
      }
      for (let iteration = 0; iteration < 250; iteration += 1) {
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            const reader = await nodeWikiGraphPlatform.database.open(file, {
              mode: "readonly",
            });
            try {
              await expect(
                reader.queryOne("SELECT value FROM marker"),
              ).resolves.toEqual({ value: 42 });
            } finally {
              await reader.close();
            }
          }),
        );
      }
    });
  }, 120_000);

  it("supports concurrent WAL readers below a long Windows path", async () => {
    if (process.platform !== "win32") return;
    await withTempDir("wikigraph-wal-long-path-", async (path) => {
      const root = new NodeDirectory(join(path, "a".repeat(210)));
      const file = await root.createFile("state.sqlite");
      const database = await nodeWikiGraphPlatform.database.open(file, {
        create: true,
        mode: "readwrite",
      });
      try {
        await database.execute(
          "PRAGMA journal_mode = WAL; CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES (42)",
        );
      } finally {
        await database.close();
      }

      for (let iteration = 0; iteration < 25; iteration += 1) {
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            const reader = await nodeWikiGraphPlatform.database.open(file, {
              mode: "readonly",
            });
            try {
              await expect(
                reader.queryOne("SELECT value FROM marker"),
              ).resolves.toEqual({ value: 42 });
            } finally {
              await reader.close();
            }
          }),
        );
      }

      const cleanup = await nodeWikiGraphPlatform.database.open(file, {
        create: false,
        mode: "readwrite",
      });
      try {
        await cleanup.execute(
          "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;",
        );
      } finally {
        await cleanup.close();
      }
    });
  }, 120_000);

  it("supports database and ZIP access below a long Windows path", async () => {
    if (process.platform !== "win32") return;
    await withTempDir("wikigraph-long-path-", async (path) => {
      const longRoot = join(path, "a".repeat(210));
      const root = new NodeDirectory(longRoot);
      const databaseFile = await root.createFile("state.sqlite");
      const database = await nodeWikiGraphPlatform.database.open(databaseFile, {
        create: true,
        mode: "readwrite",
      });
      await database.execute("CREATE TABLE marker (value TEXT NOT NULL)");
      await database.close();

      const zipFile = await root.createFile("state.zip");
      await nodeWikiGraphPlatform.zip.write(zipFile, [
        { data: new TextEncoder().encode("ok"), name: "marker.txt" },
      ]);
      const reader = await nodeWikiGraphPlatform.zip.open(zipFile);
      try {
        const data = await reader.readEntry("marker.txt");
        expect(Array.from(data ?? [])).toEqual(
          Array.from(new TextEncoder().encode("ok")),
        );
      } finally {
        await reader.close();
      }
    });
  });

  it("closes source readers after streaming entries and before replacing the ZIP", async () => {
    await withTempDir("wikigraph-zip-replace-", async (path) => {
      const file = new NodeFile(join(path, "archive.zip"));
      const data = new TextEncoder().encode("original entry ".repeat(20_000));
      await nodeWikiGraphPlatform.zip.write(file, [
        { name: "large.txt", data },
      ]);
      const reader = await nodeWikiGraphPlatform.zip.open(file);
      let reads = 0;
      const beforeCommit = vi.fn(async () => {
        expect(reads).toBeGreaterThan(1);
        await reader.close();
      });
      try {
        await nodeWikiGraphPlatform.zip.write(
          file,
          [
            {
              name: "large.txt",
              size: data.byteLength,
              read: async (offset, length) => {
                expect(beforeCommit).not.toHaveBeenCalled();
                reads++;
                return (await reader.readEntryRange(
                  "large.txt",
                  offset,
                  length,
                ))!;
              },
            },
          ],
          { beforeCommit },
        );
        expect(beforeCommit).toHaveBeenCalledTimes(1);
        const updated = await nodeWikiGraphPlatform.zip.open(file);
        try {
          expect(Buffer.from((await updated.readEntry("large.txt"))!)).toEqual(
            Buffer.from(data),
          );
        } finally {
          await updated.close();
        }
      } finally {
        await reader.close();
      }
    });
  });

  it("aborts ZIP publication when releasing source resources fails", async () => {
    await withTempDir("wikigraph-zip-abort-", async (path) => {
      const file = new NodeFile(join(path, "archive.zip"));
      const original = new TextEncoder().encode("original");
      await nodeWikiGraphPlatform.zip.write(file, [
        { name: "entry.txt", data: original },
      ]);
      const bytes = await readFile(file.path);
      await expect(
        nodeWikiGraphPlatform.zip.write(
          file,
          [
            {
              name: "entry.txt",
              data: new TextEncoder().encode("replacement"),
            },
          ],
          {
            beforeCommit: () =>
              Promise.reject(new Error("reader close failed")),
          },
        ),
      ).rejects.toThrow("reader close failed");
      expect(await readFile(file.path)).toEqual(bytes);
      expect(
        (await new NodeDirectory(path).list()).map((entry) => entry.name),
      ).toEqual(["archive.zip"]);
    });
  });

  it("writes byte-stable ZIP metadata", async () => {
    await withTempDir("wikigraph-stable-zip-", async (path) => {
      const write = async (name: string) => {
        const file = new NodeFile(join(path, name));
        await nodeWikiGraphPlatform.zip.write(file, [
          { data: new TextEncoder().encode("stable"), name: "entry.txt" },
        ]);
        return await readFile(file.path);
      };

      expect(await write("first.zip")).toEqual(await write("second.zip"));
    });
  });

  it("writes identical ZIP bytes across process time zones", () => {
    const moduleUrl = pathToFileURL(
      join(process.cwd(), "packages/sdk/src/node-platform.ts"),
    ).href;
    const script = `(async () => {
      const { mkdtemp, readFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { nodeWikiGraphPlatform, NodeFile } = await import(${JSON.stringify(moduleUrl)});
      const root = await mkdtemp(join(tmpdir(), "wikigraph-tz-"));
      try {
        const file = new NodeFile(join(root, "stable.zip"));
        await nodeWikiGraphPlatform.zip.write(file, [
          { data: new TextEncoder().encode("stable"), name: "entry.txt" },
        ]);
        process.stdout.write((await readFile(file.path)).toString("base64"));
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    })();`;
    const run = (timezone: string) => {
      const result = spawnSync(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["exec", "tsx", "--eval", script],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, TZ: timezone },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };

    expect(run("UTC")).toBe(run("Asia/Shanghai"));
  });

  it("opens ZIPs without scanning and supports repeated lookups, duplicates and queued close", async () => {
    await withTempDir("wikigraph-zip-lookup-", async (path) => {
      const file = new NodeFile(join(path, "lookup.zip"));
      const encode = (text: string) => new TextEncoder().encode(text);
      await nodeWikiGraphPlatform.zip.write(file, [
        { name: "a.txt", data: encode("old") },
        { name: "./a.txt", data: encode("alias") },
        { name: "a.txt", data: encode("latest") },
        { name: "./nested//b.txt", data: encode("beta") },
        { name: "./collision.txt", data: encode("first alias") },
        { name: ".//collision.txt", data: encode("second alias") },
        { name: "./collision.txt", data: encode("duplicate first alias") },
      ]);
      const scan = vi.spyOn(yauzl.ZipFile.prototype, "readEntry");
      const reader = await nodeWikiGraphPlatform.zip.open(file);
      try {
        expect(scan).not.toHaveBeenCalled();
        expect(new TextDecoder().decode(await reader.readEntry("a.txt"))).toBe(
          "latest",
        );
        expect(
          new TextDecoder().decode(await reader.readEntry("nested/b.txt")),
        ).toBe("beta");
        expect(
          new TextDecoder().decode(await reader.readEntry("collision.txt")),
        ).toBe("second alias");
        await expect(reader.listEntries()).resolves.toEqual([
          "a.txt",
          "./a.txt",
          "./nested//b.txt",
          "./collision.txt",
          ".//collision.txt",
        ]);
        const replacement = new NodeFile(join(path, "replacement.zip"));
        await nodeWikiGraphPlatform.zip.write(replacement, [
          { name: "a.txt", data: encode("replacement") },
        ]);
        await rename(join(path, "replacement.zip"), join(path, "lookup.zip"));
        const reads = Promise.all([
          reader.readEntry("a.txt"),
          reader.readEntryRange("nested/b.txt", 1, 2),
          reader.getEntrySize("missing"),
        ]);
        const closing = reader.close();
        const results = await reads;
        expect(new TextDecoder().decode(results[0])).toBe("latest");
        expect(new TextDecoder().decode(results[1])).toBe("et");
        expect(results[2]).toBeUndefined();
        await closing;
        await expect(reader.listEntries()).rejects.toThrow("closed ZIP");
      } finally {
        scan.mockRestore();
        await reader.close();
      }
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
    kind: "file",
    name: "probe.zip",
    openReader: () => Promise.reject(new Error("not used")),
    openWriter: () => Promise.resolve(writer),
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
