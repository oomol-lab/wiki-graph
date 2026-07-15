import { beforeEach, describe, expect, it, vi } from "vitest";

import { Language } from "../../packages/core/src/common/language.js";
import { DirectoryDocument } from "../../packages/core/src/document/index.js";
import type { SourceDocument } from "../../packages/core/src/source/adapter.js";
import { createDigestProgressTracker } from "../../packages/core/src/progress/index.js";
import type {
  BookMeta,
  SourceAsset,
  SourceSection,
} from "../../packages/core/src/source/index.js";
import { importSource, importSourceDocument } from "../../packages/core/src/facade/import.js";
import { withTempDir } from "../helpers/temp.js";

const serialMockState = vi.hoisted(() => ({
  blockedSerialIds: new Set<number>(),
  constructorOptions: [] as unknown[],
  generateIntoCalls: [] as Array<{
    readonly options: unknown;
    readonly serialId: number;
    readonly streamText: string;
  }>,
  writeSourceCalls: [] as Array<{
    readonly serialId: number;
    readonly streamText: string;
  }>,
  releaseSerials: new Map<number, () => void>(),
  startedResolvers: new Map<number, () => void>(),
  startedSignals: new Map<number, Promise<void>>(),
  startedSerialIds: [] as number[],
}));

vi.mock("../../packages/core/src/serial.js", () => ({
  discoverSerial: async (input: {
    readonly stream: AsyncIterable<string> | Iterable<string>;
  }) => {
    let streamText = "";

    for await (const chunk of input.stream) {
      streamText += chunk;
    }

    return {
      fragments: streamText.trim() === "" ? 0 : 1,
      words: streamText
        .trim()
        .split(/\s+/)
        .filter((value) => value !== "").length,
    };
  },
  SerialGeneration: class {
    readonly #document: DirectoryDocument;

    public constructor(options: { readonly document: DirectoryDocument }) {
      serialMockState.constructorOptions.push(options);
      this.#document = options.document;
    }

    public async generateInto(
      serialId: number,
      stream: AsyncIterable<string> | Iterable<string>,
      options: unknown,
    ): Promise<{ readonly id: number }> {
      serialMockState.startedSerialIds.push(serialId);
      serialMockState.startedResolvers.get(serialId)?.();

      if (serialMockState.blockedSerialIds.has(serialId)) {
        await new Promise<void>((resolve) => {
          serialMockState.releaseSerials.set(serialId, resolve);
        });
      }

      let streamText = "";

      for await (const chunk of stream) {
        streamText += chunk;
      }

      serialMockState.generateIntoCalls.push({
        options,
        serialId,
        streamText,
      });

      await this.#document.serials.createWithId(serialId);
      await this.#document.serials.setTopologyReady(serialId);
      await this.#document.writeSummary(serialId, streamText.trim());

      return { id: serialId };
    }
  },
  writeSerialSource: async (
    document: DirectoryDocument,
    serialId: number,
    stream: AsyncIterable<string> | Iterable<string>,
  ) => {
    let streamText = "";

    for await (const chunk of stream) {
      streamText += chunk;
    }

    serialMockState.writeSourceCalls.push({
      serialId,
      streamText,
    });
    const draft = await document.getSerialFragments(serialId).createDraft();

    draft.addSentence(streamText, 1);
    await draft.commit();
  },
}));

describe("facade/import", () => {
  beforeEach(() => {
    serialMockState.blockedSerialIds.clear();
    serialMockState.constructorOptions.length = 0;
    serialMockState.generateIntoCalls.length = 0;
    serialMockState.releaseSerials.clear();
    serialMockState.startedResolvers.clear();
    serialMockState.startedSignals.clear();
    serialMockState.startedSerialIds.length = 0;
    serialMockState.writeSourceCalls.length = 0;
  });

  it("imports source sections into an empty document with optional toc titles", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const meta = createBookMeta({
        title: "Source Fixture",
      });
      const cover = createCover();
      const sourceDocument = createSourceDocument({
        cover,
        meta,
        sections: [
          createSourceSection({
            children: [
              createSourceSection({
                hasContent: true,
                streamText: "Nested summary",
                title: " ",
              }),
            ],
            hasContent: false,
            title: "  ",
          }),
          createSourceSection({
            hasContent: true,
            streamText: "Second summary",
          }),
        ],
      });

      try {
        const imported = await importSourceDocument(sourceDocument, {
          document,
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          userLanguage: Language.SimplifiedChinese,
        });

        expect(imported.meta).toBe(meta);
        expect(imported.cover).toBe(cover);
        expect(imported.serials).toHaveLength(2);
        expect(imported.serials.map((serial) => serial.id)).toStrictEqual([
          1, 2,
        ]);
        expect(imported.toc.items).toStrictEqual([
          {
            children: [
              {
                children: [],
                serialId: 1,
              },
            ],
          },
          {
            children: [],
            serialId: 2,
          },
        ]);

        expect(await document.readBookMeta()).toStrictEqual(meta);
        expect(await document.readCover()).toMatchObject({
          mediaType: "image/png",
          path: "images/cover.png",
        });
        expect(await document.readSummary(1)).toBe("Nested summary");
        expect(await document.readSummary(2)).toBe("Second summary");
        expect(await document.readToc()).toStrictEqual(imported.toc);
        expect(await document.serials.listIds()).toStrictEqual([1, 2]);
        expect(serialMockState.generateIntoCalls).toStrictEqual([
          {
            options: {
              extractionPrompt: "Keep key beats",
              userLanguage: Language.SimplifiedChinese,
            },
            serialId: 1,
            streamText: "Nested summary",
          },
          {
            options: {
              extractionPrompt: "Keep key beats",
              userLanguage: Language.SimplifiedChinese,
            },
            serialId: 2,
            streamText: "Second summary",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("uses the book title as fallback when importing a single untitled section", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        const imported = await importSourceDocument(
          createSourceDocument({
            meta: createBookMeta({
              title: "Single Section Book",
            }),
            sections: [
              createSourceSection({
                hasContent: true,
                streamText: "Only summary",
                title: " ",
              }),
            ],
          }),
          {
            document,
            extractionPrompt: "Keep key beats",
            llm: {} as never,
          },
        );

        expect(imported.toc.items).toStrictEqual([
          {
            children: [],
            serialId: 1,
            title: "Single Section Book",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("imports source documents to planned without opening section content", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const openCounts = new Map<string, number>();

      try {
        const imported = await importSourceDocument(
          createSourceDocument({
            meta: createBookMeta(),
            sections: [
              createSourceSection({
                hasContent: true,
                openCounts,
                streamText: "Should not be opened",
                title: "Draft",
              }),
            ],
          }),
          {
            document,
            extractionPrompt: "Keep key beats",
            targetStage: "planned",
          },
        );

        expect(imported.serials.map((serial) => serial.id)).toStrictEqual([1]);
        expect(openCounts.get("Draft")).toBeUndefined();
        expect(serialMockState.generateIntoCalls).toHaveLength(0);
        expect(serialMockState.writeSourceCalls).toHaveLength(0);
        expect(await document.readSummary(1)).toBeUndefined();
      } finally {
        await document.release();
      }
    });
  });

  it("imports source documents to sourced without graph or summary generation", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await importSourceDocument(
          createSourceDocument({
            meta: createBookMeta(),
            sections: [
              createSourceSection({
                hasContent: true,
                streamText: "Source only",
                title: "Source Chapter",
              }),
            ],
          }),
          {
            document,
            extractionPrompt: "Keep key beats",
            targetStage: "sourced",
          },
        );

        expect(serialMockState.generateIntoCalls).toHaveLength(0);
        expect(serialMockState.writeSourceCalls).toStrictEqual([
          {
            serialId: 1,
            streamText: "Source only",
          },
        ]);
        expect(
          await document.getSerialFragments(1).listFragmentIds(),
        ).toStrictEqual([0]);
        expect(await document.readSummary(1)).toBeUndefined();
      } finally {
        await document.release();
      }
    });
  });

  it("opens the source through the adapter path wrapper", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const sourceDocument = createSourceDocument({
        meta: createBookMeta({
          title: "Adapter Fixture",
        }),
        sections: [
          createSourceSection({
            hasContent: true,
            streamText: "Adapter summary",
            title: "Chapter 1",
          }),
        ],
      });
      const adapter = {
        format: "txt" as const,
        openSession: async <T>(
          _path: string,
          operation: (document: SourceDocument) => Promise<T>,
        ): Promise<T> => await operation(sourceDocument),
      };

      try {
        const imported = await importSource({
          adapter,
          document,
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          path: "/tmp/source.txt",
        });

        expect(imported.toc.items[0]).toMatchObject({
          serialId: 1,
          title: "Chapter 1",
        });
      } finally {
        await document.release();
      }
    });
  });

  it("discovers all serials before generation and reopens sections for import", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const openCounts = new Map<string, number>();
      const events: unknown[] = [];

      try {
        await importSourceDocument(
          createSourceDocument({
            meta: createBookMeta({
              title: "Discovery Fixture",
            }),
            sections: [
              createSourceSection({
                hasContent: true,
                openCounts,
                streamText: "alpha beta",
                title: "Chapter 1",
              }),
              createSourceSection({
                hasContent: true,
                openCounts,
                streamText: "gamma delta epsilon",
                title: "Chapter 2",
              }),
            ],
          }),
          {
            digestProgressTracker: createDigestProgressTracker({
              onProgress: (event) => {
                events.push(event);
              },
              operation: "digest-txt",
            }),
            document,
            extractionPrompt: "Keep key beats",
            llm: {} as never,
          },
        );

        expect(events).toContainEqual({
          available: true,
          serials: [
            {
              fragments: 1,
              id: 1,
              title: "Chapter 1",
              words: 2,
            },
            {
              fragments: 1,
              id: 2,
              title: "Chapter 2",
              words: 3,
            },
          ],
          type: "serials-discovered",
        });
        expect(openCounts.get("Chapter 1")).toBe(2);
        expect(openCounts.get("Chapter 2")).toBe(2);
      } finally {
        await document.release();
      }
    });
  });

  it("reuses source-provided words counts for discovery", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const openCounts = new Map<string, number>();
      const events: unknown[] = [];

      try {
        await importSourceDocument(
          createSourceDocument({
            meta: createBookMeta({
              title: "Discovery Fixture",
            }),
            sections: [
              createSourceSection({
                hasContent: true,
                openCounts,
                streamText: "alpha beta",
                title: "Chapter 1",
                wordsCount: 2,
              }),
              createSourceSection({
                hasContent: false,
                openCounts,
                streamText: "",
                title: "Spacer",
                wordsCount: 0,
              }),
              createSourceSection({
                hasContent: true,
                openCounts,
                streamText: "gamma delta epsilon",
                title: "Chapter 2",
                wordsCount: 3,
              }),
            ],
          }),
          {
            digestProgressTracker: createDigestProgressTracker({
              onProgress: (event) => {
                events.push(event);
              },
              operation: "digest-epub",
            }),
            document,
            extractionPrompt: "Keep key beats",
            llm: {} as never,
          },
        );

        expect(events).toContainEqual({
          available: true,
          serials: [
            {
              id: 1,
              title: "Chapter 1",
              words: 2,
            },
            {
              id: 2,
              title: "Chapter 2",
              words: 3,
            },
          ],
          type: "serials-discovered",
        });
        expect(openCounts.get("Chapter 1")).toBe(1);
        expect(openCounts.get("Spacer")).toBeUndefined();
        expect(openCounts.get("Chapter 2")).toBe(1);
      } finally {
        await document.release();
      }
    });
  });

  it("runs planned serial generation up to the llm concurrent limit", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);
      const startedPromises = new Map<number, Promise<void>>();

      for (const serialId of [1, 2, 3]) {
        startedPromises.set(
          serialId,
          new Promise<void>((resolve) => {
            serialMockState.startedResolvers.set(serialId, resolve);
          }),
        );
      }

      serialMockState.blockedSerialIds.add(1);
      serialMockState.blockedSerialIds.add(2);

      try {
        const importPromise = importSourceDocument(
          createSourceDocument({
            meta: createBookMeta({
              title: "Concurrent Fixture",
            }),
            sections: [
              createSourceSection({
                hasContent: true,
                streamText: "Chapter one",
                title: "Chapter 1",
              }),
              createSourceSection({
                hasContent: true,
                streamText: "Chapter two",
                title: "Chapter 2",
              }),
              createSourceSection({
                hasContent: true,
                streamText: "Chapter three",
                title: "Chapter 3",
              }),
            ],
          }),
          {
            document,
            extractionPrompt: "Keep key beats",
            llm: {
              config: {
                concurrent: 2,
              },
            } as never,
          },
        );

        await Promise.all([startedPromises.get(1), startedPromises.get(2)]);
        expect(serialMockState.startedSerialIds).toStrictEqual([1, 2]);

        serialMockState.releaseSerials.get(1)?.();

        await startedPromises.get(3);
        expect(serialMockState.startedSerialIds).toStrictEqual([1, 2, 3]);

        serialMockState.releaseSerials.get(2)?.();

        const imported = await importPromise;

        expect(imported.serials.map((serial) => serial.id)).toStrictEqual([
          1, 2, 3,
        ]);
      } finally {
        serialMockState.releaseSerials.get(1)?.();
        serialMockState.releaseSerials.get(2)?.();
        await document.release();
      }
    });
  });

  it("rejects imports when the target document already has content", async () => {
    await withTempDir("wikigraph-import-", async (path) => {
      const sourceDocument = createSourceDocument({
        meta: createBookMeta(),
        sections: [],
      });

      await expectImportError(
        `${path}/meta`,
        async (document) => {
          await document.openSession(async (openedDocument) => {
            await openedDocument.writeBookMeta(createBookMeta());
          });
        },
        sourceDocument,
        "Archive metadata already exists",
      );
      await expectImportError(
        `${path}/cover`,
        async (document) => {
          await document.openSession(async (openedDocument) => {
            await openedDocument.writeCover(createCover());
          });
        },
        sourceDocument,
        "Document cover already exists",
      );
      await expectImportError(
        `${path}/toc`,
        async (document) => {
          await document.openSession(async (openedDocument) => {
            await openedDocument.writeToc({
              items: [],
              version: 1,
            });
          });
        },
        sourceDocument,
        "Document TOC already exists",
      );
      await expectImportError(
        `${path}/serial`,
        async (document) => {
          await document.openSession(async (openedDocument) => {
            await openedDocument.createSerial();
          });
        },
        sourceDocument,
        "Document already contains serials",
      );
    });
  });
});

function createBookMeta(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    authors: ["Ari Lantern"],
    description: "Import fixture",
    identifier: "urn:test:import",
    language: "en",
    publishedAt: "2026-01-01",
    publisher: "Open Sample Press",
    sourceFormat: "txt",
    title: "Import Fixture",
    version: 1,
    ...overrides,
  };
}

function createCover(): SourceAsset {
  return {
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    path: "images/cover.png",
  };
}

function createSourceDocument(input: {
  readonly cover?: SourceAsset;
  readonly meta: BookMeta;
  readonly sections: readonly SourceSection[];
}): SourceDocument {
  return {
    readCover: () => Promise.resolve(input.cover),
    readMeta: () => Promise.resolve(input.meta),
    readSections: () => Promise.resolve(input.sections),
  };
}

function createSourceSection(input: {
  readonly children?: readonly SourceSection[];
  readonly hasContent: boolean;
  readonly openCounts?: Map<string, number>;
  readonly streamText?: string;
  readonly title?: string;
  readonly wordsCount?: number;
}): SourceSection {
  const id = crypto.randomUUID();

  return {
    children: input.children ?? [],
    hasContent: input.hasContent,
    id,
    open: () => {
      if (input.openCounts !== undefined) {
        input.openCounts.set(id, (input.openCounts.get(id) ?? 0) + 1);
        if (input.title !== undefined) {
          input.openCounts.set(
            input.title,
            (input.openCounts.get(input.title) ?? 0) + 1,
          );
        }
      }

      return Promise.resolve(
        input.streamText === undefined ? [] : [input.streamText],
      );
    },
    title: input.title,
    wordsCount: input.wordsCount,
  };
}

async function expectImportError(
  documentPath: string,
  seed: (document: DirectoryDocument) => Promise<void>,
  sourceDocument: SourceDocument,
  message: string,
): Promise<void> {
  const document = await DirectoryDocument.open(documentPath);

  try {
    await seed(document);
    await expect(
      importSourceDocument(sourceDocument, {
        document,
        extractionPrompt: "Keep key beats",
        llm: {} as never,
      }),
    ).rejects.toThrow(message);
  } finally {
    await document.release();
  }
}
