import { mkdir, rename } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import {
  readWikgArchiveEntry,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { replaceChapterFtsIndexArtifact } from "../../../../packages/core/src/retrieval/index-artifact/index.js";
import {
  isArchiveSearchIndexCurrent,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/index.js";
import { readArchivePage } from "../../../../packages/core/src/retrieval/query/view.js";
import {
  installWikiGraphPlatform,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  installNodeWikiGraphPlatform,
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

afterEach(() => {
  installNodeWikiGraphPlatform();
});

describe("wikg/wiki-graph-archive-file", () => {
  it("reads and writes an archive through opaque File capabilities", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Original" }],
      });

      await file.write(async (document) => {
        await document.replaceToc({
          items: [
            { children: [], key: "chapter", serialId: 1, title: "Updated" },
          ],
          version: 1,
        });
      });

      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Updated" }],
      });
    });
  });

  it("does not materialize unrelated ZIP entries during an ordinary read", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const initialReader = await nodeWikiGraphPlatform.zip.open(archive);
      const sentinel = (await initialReader.listEntries()).find((entry) =>
        entry.startsWith("texts/"),
      );
      await initialReader.close();
      expect(sentinel).toBeDefined();

      const readEntries: string[] = [];
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        zip: {
          ...nodeWikiGraphPlatform.zip,
          open: async (file) => {
            const reader = await nodeWikiGraphPlatform.zip.open(file);
            return {
              close: async () => await reader.close(),
              copyEntry: async (name, target) => {
                readEntries.push(name);
                if (name === sentinel) {
                  throw new Error(`Unrelated ZIP entry was read: ${name}`);
                }
                return await reader.copyEntry(name, target);
              },
              getEntrySize: async (name) => await reader.getEntrySize(name),
              listEntries: async () => await reader.listEntries(),
              readEntryRange: async (name, offset, length) =>
                await reader.readEntryRange(name, offset, length),
              readEntry: async (name) => {
                readEntries.push(name);
                if (name === sentinel) {
                  throw new Error(`Unrelated ZIP entry was read: ${name}`);
                }
                return await reader.readEntry(name);
              },
            };
          },
        },
      });

      await expect(
        new WikiGraphArchiveFile(archive).read(
          async (digest) => await digest.readToc(),
        ),
      ).resolves.toMatchObject({ items: [{ title: "Original" }] });
      expect(readEntries).not.toContain(sentinel);
    });
  });

  it("range-reads a late archive snippet without materializing its prefix", async () => {
    const prefix = `${"a".repeat(512 * 1024)}.`;
    const target = "朱元璋抵达洪都。";
    await withArchiveFixture(
      async ({ archive }) => {
        const initialReader = await nodeWikiGraphPlatform.zip.open(archive);
        const textEntry = (await initialReader.listEntries()).find((entry) =>
          entry.startsWith("texts/"),
        );
        await initialReader.close();
        expect(textEntry).toBeDefined();

        let textRangeBytesRead = 0;
        installWikiGraphPlatform({
          ...nodeWikiGraphPlatform,
          zip: {
            ...nodeWikiGraphPlatform.zip,
            open: async (file) => {
              const reader = await nodeWikiGraphPlatform.zip.open(file);
              return {
                close: async () => await reader.close(),
                copyEntry: async (name, destination) => {
                  if (name === textEntry) {
                    throw new Error(`Whole text entry copied: ${name}`);
                  }
                  return await reader.copyEntry(name, destination);
                },
                getEntrySize: async (name) => await reader.getEntrySize(name),
                listEntries: async () => await reader.listEntries(),
                readEntry: async (name) => {
                  if (name === textEntry) {
                    throw new Error(`Whole text entry read: ${name}`);
                  }
                  return await reader.readEntry(name);
                },
                readEntryRange: async (name, offset, length) => {
                  const content = await reader.readEntryRange(
                    name,
                    offset,
                    length,
                  );
                  if (name === textEntry) {
                    textRangeBytesRead += content?.byteLength ?? 0;
                  }
                  return content;
                },
              };
            },
          },
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method -- the mock restores the original receiver with call().
        const originalRead = NodeFile.prototype.read;
        const read = vi
          .spyOn(NodeFile.prototype, "read")
          .mockImplementation(function (this: NodeFile, options) {
            if (this.path === archive.path) {
              return Promise.reject(
                new Error(`Whole archive file read: ${this.path}`),
              );
            }
            return originalRead.call(this, options);
          });
        try {
          const file = new WikiGraphArchiveFile(archive);
          await expect(
            file.readDocument(
              async (document) =>
                await readArchivePage(
                  document,
                  "wikg://chapter/chapter/source#2",
                ),
            ),
          ).resolves.toMatchObject({
            fragment: { text: target },
          });
          expect(textRangeBytesRead).toBe(
            new TextEncoder().encode(target).length,
          );
        } finally {
          read.mockRestore();
        }
      },
      {
        sentences: [
          [prefix, 1],
          [target, 4],
        ],
      },
    );
  });

  it("appends archive text through a range-backed transactional settlement", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const initialReader = await nodeWikiGraphPlatform.zip.open(archive);
      const textEntry = (await initialReader.listEntries()).find((entry) =>
        entry.startsWith("texts/"),
      );
      await initialReader.close();
      expect(textEntry).toBeDefined();

      let rangedTextBytes = 0;
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        zip: {
          ...nodeWikiGraphPlatform.zip,
          open: async (file) => {
            const reader = await nodeWikiGraphPlatform.zip.open(file);
            return {
              close: async () => await reader.close(),
              copyEntry: async (name, destination) => {
                if (name === textEntry) {
                  throw new Error(`Whole text entry copied: ${name}`);
                }
                return await reader.copyEntry(name, destination);
              },
              getEntrySize: async (name) => await reader.getEntrySize(name),
              listEntries: async () => await reader.listEntries(),
              readEntry: async (name) => {
                if (name === textEntry) {
                  throw new Error(`Whole text entry read: ${name}`);
                }
                return await reader.readEntry(name);
              },
              readEntryRange: async (name, offset, length) => {
                const content = await reader.readEntryRange(
                  name,
                  offset,
                  length,
                );
                if (name === textEntry) {
                  rangedTextBytes += content?.byteLength ?? 0;
                }
                return content;
              },
            };
          },
        },
      });

      const file = new WikiGraphArchiveFile(archive);
      await file.write(async (document) => {
        const draft = await document.getSerialFragments(1).createDraft();
        draft.addSentence("追加正文。", 2);
        await draft.commit();
      });

      expect(rangedTextBytes).toBe(
        new TextEncoder().encode("Persistent archive cache source.").length,
      );
      await expect(
        new WikiGraphArchiveFile(archive).readDocument(
          async (document) =>
            await readArchivePage(document, "wikg://chapter/chapter/source#2"),
        ),
      ).resolves.toMatchObject({ fragment: { text: "追加正文。" } });
    });
  });

  it("rolls back archive writes when the operation fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.write(async (document) => {
          await document.replaceToc({ items: [], version: 1 });
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ title: "Original" }],
      });
    });
  });

  it("serializes concurrent access by opaque file identity", async () => {
    await withArchiveFixture(async ({ archive }) => {
      let watchSecondAccess = false;
      let secondTouchedBackingFile = false;
      let markSecondQueued!: () => void;
      let rejectSecondQueued!: (error: Error) => void;
      const secondQueued = new Promise<void>((resolve, reject) => {
        markSecondQueued = resolve;
        rejectSecondQueued = reject;
      });
      // Identity is read at the queue boundary, before the backing file opens.
      // This makes the second caller's arrival observable without a timer.
      const observedArchive = new Proxy(archive, {
        get: (target, property, receiver) => {
          if (watchSecondAccess && property === "path") {
            secondTouchedBackingFile = true;
          }
          if (watchSecondAccess && property === "identity") {
            watchSecondAccess = false;
            if (secondTouchedBackingFile) {
              rejectSecondQueued(
                new Error(
                  "Second archive access touched the backing file before reaching the identity queue.",
                ),
              );
            } else {
              markSecondQueued();
            }
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      const firstFile = new WikiGraphArchiveFile(archive);
      const secondFile = new WikiGraphArchiveFile(observedArchive);
      const order: string[] = [];
      let activeSessions = 0;
      let maxConcurrentSessions = 0;
      let markFirstEntered!: () => void;
      const firstEntered = new Promise<void>((resolve) => {
        markFirstEntered = resolve;
      });
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = firstFile.write(async () => {
        activeSessions += 1;
        maxConcurrentSessions = Math.max(maxConcurrentSessions, activeSessions);
        order.push("first-start");
        markFirstEntered();
        try {
          await firstGate;
          order.push("first-end");
        } finally {
          activeSessions -= 1;
        }
      });

      await firstEntered;
      watchSecondAccess = true;
      const second = secondFile.read(() => {
        activeSessions += 1;
        maxConcurrentSessions = Math.max(maxConcurrentSessions, activeSessions);
        try {
          order.push("second");
        } finally {
          activeSessions -= 1;
        }
      });
      let queueError: Error | undefined;
      try {
        await secondQueued;
      } catch (error) {
        queueError = error instanceof Error ? error : new Error(String(error));
      } finally {
        releaseFirst();
      }
      if (queueError !== undefined) {
        await Promise.allSettled([first, second]);
        throw queueError;
      }
      await Promise.all([first, second]);

      expect(maxConcurrentSessions).toBe(1);
      expect(order).toStrictEqual(["first-start", "first-end", "second"]);
    });
  });

  it("keeps an external search index cache across archive sessions", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);

      await file.write(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            false,
          );
          await rebuildArchiveSearchIndex(document);
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      await file.readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
      await expect(readWikgArchiveEntry(archive, "index.db")).resolves.toBe(
        undefined,
      );
    });
  });

  it("reuses an external search index cache after its archive moves", async () => {
    await withArchiveFixture(async ({ archive, root }) => {
      await new WikiGraphArchiveFile(archive).write(
        async (document) => {
          await rebuildArchiveSearchIndex(document);
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      const movedPath = join(root, "moved.wikg");
      await rename(archive.path, movedPath);
      const movedArchive = new NodeFile(movedPath);

      await new WikiGraphArchiveFile(movedArchive).readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
    });
  });

  it("rolls back an external search index cache when a session fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await file.write(
        async (document) => {
          await rebuildArchiveSearchIndex(document);
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      await expect(
        file.write(
          async (document) => {
            await document.writeSearchIndexDatabase(async (database) => {
              await database.run("DELETE FROM search_index_state");
            });
            throw new Error("stop cache write");
          },
          { searchIndexWritebackPolicy: "cache" },
        ),
      ).rejects.toThrow("stop cache write");

      await file.readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
    });
  });
});

async function withArchiveFixture(
  operation: (fixture: {
    readonly archive: NodeFile;
    readonly root: string;
  }) => Promise<void>,
  options: {
    readonly sentences?: ReadonlyArray<readonly [text: string, words: number]>;
  } = {},
): Promise<void> {
  await withTempDir("wikigraph-host-archive-", async (root) => {
    const stateRoot = join(root, "state");
    const documentPath = join(root, "document");
    await mkdir(documentPath, { recursive: true });
    await withWikiGraphStorage(
      createNodeWikiGraphStorage(stateRoot),
      async () => {
        const directory = new NodeDirectory(documentPath);
        const document = await DirectoryDocument.open(directory);
        try {
          await document.openSession(async (openedDocument) => {
            await openedDocument.createSerial();
            const draft = await openedDocument
              .getSerialFragments(1)
              .createDraft();
            for (const [text, words] of options.sentences ?? [
              ["Persistent archive cache source.", 4] as const,
            ]) {
              draft.addSentence(text, words);
            }
            await draft.commit();
          });
          await document.writeToc({
            items: [
              { children: [], key: "chapter", serialId: 1, title: "Original" },
            ],
            version: 1,
          });
          await replaceChapterFtsIndexArtifact(document, 1);
        } finally {
          await document.release();
        }
        const archive = new NodeFile(join(root, "book.wikg"));
        await writeWikgArchive(directory, archive);
        await operation({ archive, root });
      },
    );
  });
}
