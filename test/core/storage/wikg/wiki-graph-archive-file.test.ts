import { mkdir, rename } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  DirectoryDocument,
} from "../../../../packages/core/src/document/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import { withHostArchiveSession } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/host-session.js";
import { withCoordinatorState } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/state.js";
import {
  readWikgArchiveEntry,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { replaceChapterFtsIndexArtifact } from "../../../../packages/core/src/retrieval/index-artifact/index.js";
import {
  isArchiveSearchIndexCurrent,
  listArchiveEvidence,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/index.js";
import { readArchivePage } from "../../../../packages/core/src/retrieval/query/view.js";
import {
  getWikiGraphStorage,
  installWikiGraphPlatform,
  withWikiGraphStorage,
  type Directory,
  type File,
  type HostZipWriteEntry,
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
      },
      {
        sentences: [
          [prefix, 1],
          [target, 4],
        ],
      },
    );
  });

  it("keeps public retrieval bounded when archive text rejects whole-entry reads", async () => {
    await withArchiveFixture(
      async ({ archive }) => {
        const initialReader = await nodeWikiGraphPlatform.zip.open(archive);
        const textEntries = new Set(
          (await initialReader.listEntries()).filter((entry) =>
            entry.startsWith("texts/"),
          ),
        );
        const databaseEntry = (await initialReader.listEntries()).find(
          (entry) => entry === "database.db",
        );
        await initialReader.close();
        expect(textEntries.size).toBeGreaterThan(0);
        expect(databaseEntry).toBeDefined();
        let databaseRangeBytes = 0;

        installWikiGraphPlatform({
          ...nodeWikiGraphPlatform,
          zip: {
            ...nodeWikiGraphPlatform.zip,
            open: async (file) => {
              const reader = await nodeWikiGraphPlatform.zip.open(file);
              return {
                close: async () => await reader.close(),
                copyEntry: async (name, destination) => {
                  if (textEntries.has(name)) {
                    throw new Error(`Whole text entry copied: ${name}`);
                  }
                  if (name === databaseEntry) {
                    throw new Error(`Whole database entry copied: ${name}`);
                  }
                  return await reader.copyEntry(name, destination);
                },
                getEntrySize: async (name) => await reader.getEntrySize(name),
                listEntries: async () => await reader.listEntries(),
                readEntry: async (name) => {
                  if (textEntries.has(name)) {
                    throw new Error(`Whole text entry read: ${name}`);
                  }
                  if (name === databaseEntry) {
                    throw new Error(`Whole database entry read: ${name}`);
                  }
                  return await reader.readEntry(name);
                },
                readEntryRange: async (name, offset, length) => {
                  const content = await reader.readEntryRange(
                    name,
                    offset,
                    length,
                  );
                  if (name === databaseEntry) {
                    databaseRangeBytes += content?.byteLength ?? 0;
                  }
                  return content;
                },
              };
            },
          },
        });

        await new WikiGraphArchiveFile(archive).readDocument(
          async (document) => {
            for (const uri of [
              "wikg://chunk/100",
              "wikg://entity/Q1",
              "wikg://triple/Q1/mentions/Q2",
              "wikg://entity/Q3",
            ]) {
              const evidence = await listArchiveEvidence(document, uri);
              expect(evidence).toMatchObject({
                items: [{ type: "source" }],
              });
              expect(evidence.items[0]?.source).toContain("After context.");
            }
            const nodePage = await readArchivePage(document, "node:100");
            expect(nodePage).toMatchObject({
              type: "node",
            });
            if (!("sourceFragments" in nodePage)) {
              throw new Error("Expected node source fragments.");
            }
            expect(nodePage.sourceFragments[0]?.text).toContain(
              "Bounded archive source.",
            );
            const sourcePage = await readArchivePage(
              document,
              "wikg://chapter/chapter/source#1",
              {
                backlinks: true,
              },
            );
            expect(sourcePage).toHaveProperty("backlinks");
            if (
              !("backlinks" in sourcePage) ||
              sourcePage.backlinks === undefined
            ) {
              throw new Error("Expected source backlinks.");
            }
            expect(
              sourcePage.backlinks.chunks.items.map((item) => item.id),
            ).toContain("node:100");
            expect(
              sourcePage.backlinks.entities.items.map((item) => item.id),
            ).toContain("wikg://entity/Q1");
            expect(
              sourcePage.backlinks.triples.items.map((item) => item.id),
            ).toContain("wikg://triple/Q1/mentions/Q2");
          },
        );
        expect(databaseRangeBytes).toBeGreaterThan(0);
      },
      {
        seedRetrieval: true,
        sentences: [
          ["Before context.", 2],
          ["Bounded archive source.", 3],
          ["After context.", 2],
        ],
      },
    );
  });

  it.each(["index.db", "fts.db"] as const)(
    "materializes archive search entry %s through bounded ranges",
    async (entryName) => {
      await withArchiveFixture(async ({ archive, root }) => {
        const source = new NodeFile(join(root, `${entryName}.source`));
        const sourceSize = await createLargeSearchDatabase(source);
        await addArchiveEntry(archive, entryName, source);
        const rangeLengths: number[] = [];

        installWikiGraphPlatform({
          ...nodeWikiGraphPlatform,
          zip: {
            ...nodeWikiGraphPlatform.zip,
            open: async (file) => {
              const reader = await nodeWikiGraphPlatform.zip.open(file);
              return {
                close: async () => await reader.close(),
                copyEntry: async (name, target) => {
                  if (name === entryName) {
                    throw new Error(`Whole search entry copied: ${name}`);
                  }
                  return await reader.copyEntry(name, target);
                },
                getEntrySize: async (name) => await reader.getEntrySize(name),
                listEntries: async () => await reader.listEntries(),
                readEntry: async (name) => {
                  if (name === entryName) {
                    throw new Error(`Whole search entry read: ${name}`);
                  }
                  return await reader.readEntry(name);
                },
                readEntryRange: async (name, offset, length) => {
                  if (name === entryName) rangeLengths.push(length);
                  return await reader.readEntryRange(name, offset, length);
                },
              };
            },
          },
        });

        await withHostArchiveSession(archive, async (session) => {
          const cache = await session.materializeSearchIndexCache({
            createIfMissing: false,
          });
          await expect(readSearchMarker(cache)).resolves.toBe(1);
        });

        expect(rangeLengths.length).toBeGreaterThan(1);
        expect(Math.max(...rangeLengths)).toBeLessThanOrEqual(64 * 1024);
        expect(rangeLengths.reduce((sum, length) => sum + length, 0)).toBe(
          sourceSize,
        );
      });
    },
  );

  it("copies a persistent search cache through bounded file reads", async () => {
    await withArchiveFixture(async ({ archive }) => {
      let sourceSize = 0;
      await withHostArchiveSession(archive, async (session) => {
        const cache = await session.materializeSearchIndexCache({
          createIfMissing: true,
        });
        sourceSize = await createLargeSearchDatabase(cache);
        session.markSearchIndexCacheDirty(cache);
      });

      const storage = getWikiGraphStorage();
      const rangeLengths: number[] = [];
      const documentStore = wrapPersistentCacheReaders(
        storage.documentStore,
        (length) => rangeLengths.push(length),
      );
      await withWikiGraphStorage({ ...storage, documentStore }, async () => {
        await withHostArchiveSession(archive, async (session) => {
          const cache = await session.materializeSearchIndexCache({
            createIfMissing: false,
          });
          await expect(readSearchMarker(cache)).resolves.toBe(1);
        });
      });

      expect(rangeLengths.length).toBeGreaterThan(1);
      expect(Math.max(...rangeLengths)).toBeLessThanOrEqual(64 * 1024);
      expect(rangeLengths.reduce((sum, length) => sum + length, 0)).toBe(
        sourceSize,
      );
    });
  });

  it("preserves operation errors and unregisters owners when cleanup fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const storage = getWikiGraphStorage();
      let failCleanup = false;
      const documentStore = new Proxy(storage.documentStore, {
        get(target, property, receiver) {
          if (property === "getDirectory") {
            return async (name: string) => {
              if (failCleanup && name === ".wikg-work") {
                throw new Error("workspace cleanup failed");
              }
              return await target.getDirectory(name);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await withWikiGraphStorage({ ...storage, documentStore }, async () => {
        await expect(
          withHostArchiveSession(archive, async (session) => {
            await session.materializeSearchIndexCache({
              createIfMissing: true,
            });
            failCleanup = true;
            throw new Error("operation failed");
          }),
        ).rejects.toThrow("operation failed");
        failCleanup = false;
      });

      await expect(
        withCoordinatorState(
          async (database) =>
            (await database.queryOne(
              "SELECT COUNT(*) AS count FROM archive_owners",
              undefined,
              (row) => Number(row.count),
            )) ?? 0,
        ),
      ).resolves.toBe(0);
    });
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
    readonly seedRetrieval?: boolean;
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
            if (options.seedRetrieval === true) {
              await openedDocument.chunks.save({
                content: "Bounded node summary.",
                generation: 0,
                id: 100,
                label: "Bounded node",
                sentenceId: [1, 0],
                sentenceIds: [[1, 0]],
                wordsCount: 3,
                weight: 1,
              });
              await openedDocument.mentions.saveMany([
                {
                  chapterId: 1,
                  id: "bounded-source",
                  qid: "Q1",
                  rangeEnd: 7,
                  rangeStart: 0,
                  sentenceIndex: 0,
                  surface: "Bounded",
                },
                {
                  chapterId: 1,
                  id: "bounded-target",
                  qid: "Q2",
                  rangeEnd: 14,
                  rangeStart: 8,
                  sentenceIndex: 0,
                  surface: "archive",
                },
                {
                  chapterId: 1,
                  id: "legacy-offset-only",
                  qid: "Q3",
                  rangeEnd: 22,
                  rangeStart: 16,
                  surface: "source",
                },
              ]);
              await openedDocument.mentionLinks.save({
                evidenceSentenceIds: [[1, 0]],
                id: "bounded-link",
                predicate: "mentions",
                sourceMentionId: "bounded-source",
                targetMentionId: "bounded-target",
              });
            }
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

function createLargeTestPayload(): Uint8Array {
  const content = new Uint8Array(2 * 64 * 1024 + 17);
  for (let index = 0; index < content.byteLength; index += 1) {
    content[index] = index % 251;
  }
  return content;
}

async function addArchiveEntry(
  archive: File,
  entryName: string,
  source: File,
): Promise<void> {
  const reader = await nodeWikiGraphPlatform.zip.open(archive);
  try {
    const names = await reader.listEntries();
    async function* entries(): AsyncGenerator<HostZipWriteEntry> {
      for (const name of names) {
        if (name === entryName) continue;
        const size = await reader.getEntrySize(name);
        if (size === undefined) continue;
        yield {
          name,
          size,
          read: async (offset, length) => {
            const data = await reader.readEntryRange(name, offset, length);
            if (data === undefined) {
              throw new Error(`Archive entry disappeared: ${name}`);
            }
            return data;
          },
        };
      }
      yield { file: source, name: entryName };
    }
    await nodeWikiGraphPlatform.zip.write(archive, entries());
  } finally {
    await reader.close();
  }
}

async function createLargeSearchDatabase(file: File): Promise<number> {
  const database = await Database.open(file, "", {
    create: true,
    mode: "readwrite",
  });
  try {
    await database.run(
      "CREATE TABLE bounded_search_test (id INTEGER PRIMARY KEY, payload BLOB)",
    );
    await database.run(
      "INSERT INTO bounded_search_test (id, payload) VALUES (1, ?)",
      [createLargeTestPayload()],
    );
  } finally {
    await database.close();
  }
  const reader = await file.openReader();
  try {
    return reader.size;
  } finally {
    await reader.close();
  }
}

async function readSearchMarker(file: File): Promise<number> {
  const database = await Database.open(file, "", { mode: "readonly" });
  try {
    return (
      (await database.queryOne(
        "SELECT COUNT(*) AS count FROM bounded_search_test",
        undefined,
        (row) => Number(row.count),
      )) ?? 0
    );
  } finally {
    await database.close();
  }
}

function wrapPersistentCacheReaders(
  root: Directory,
  onRead: (length: number) => void,
): Directory {
  const wrapDirectory = (
    directory: Directory,
    relativePath: string,
  ): Directory => ({
    createDirectory: async (name) =>
      wrapDirectory(
        await directory.createDirectory(name),
        join(relativePath, name),
      ),
    createFile: async (name) => await directory.createFile(name),
    getDirectory: async (name) => {
      const child = await directory.getDirectory(name);
      return child === undefined
        ? undefined
        : wrapDirectory(child, join(relativePath, name));
    },
    getFile: async (name) => {
      const file = await directory.getFile(name);
      if (
        file === undefined ||
        name !== "index.db" ||
        !relativePath.startsWith(".wikg-cache/")
      ) {
        return file;
      }
      return wrapBoundedReader(file, onRead);
    },
    getLastModified: async () => await directory.getLastModified?.(),
    identity: directory.identity,
    kind: "directory",
    list: async () => await directory.list(),
    name: directory.name,
    remove: async (name, options) => await directory.remove(name, options),
  });
  return wrapDirectory(root, "");
}

function wrapBoundedReader(file: File, onRead: (length: number) => void): File {
  return {
    getLastModified: async () => await file.getLastModified?.(),
    identity: file.identity,
    kind: "file",
    name: file.name,
    openReader: async () => {
      const reader = await file.openReader();
      return {
        close: async () => await reader.close(),
        read: async (offset, length) => {
          if (length === reader.size) {
            throw new Error("Whole persistent search cache read");
          }
          onRead(length);
          return await reader.read(offset, length);
        },
        size: reader.size,
      };
    },
    openWriter: async () => await file.openWriter(),
  };
}
