import { access } from "fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryDocument } from "../../packages/core/src/document/index.js";

const digestMockState = vi.hoisted(() => ({
  generateCalls: [] as Array<{
    readonly options: unknown;
    readonly serialId: number;
    readonly streamText: string;
  }>,
  importCalls: [] as Array<{
    readonly adapterFormat: string;
    readonly documentPath: string;
    readonly extractionPrompt: string;
    readonly path: string;
    readonly userLanguage: string | undefined;
  }>,
  tempDocumentPaths: [] as string[],
}));

vi.mock("../../packages/core/src/serial.js", () => ({
  SerialGeneration: class {
    readonly #document: DirectoryDocument;

    public constructor(options: { readonly document: DirectoryDocument }) {
      this.#document = options.document;
      digestMockState.tempDocumentPaths.push(options.document.path);
    }

    public async generate(
      stream: AsyncIterable<string> | Iterable<string>,
      options: unknown,
    ): Promise<{ readonly id: number }> {
      const serialId = await this.#document.createSerial();
      return await this.generateInto(serialId, stream, options);
    }

    public async generateInto(
      serialId: number,
      stream: AsyncIterable<string> | Iterable<string>,
      options: unknown,
      progressTracker?: {
        advance(wordsCount: number): Promise<void>;
        begin(input: { fragments: number; words: number }): Promise<void>;
        complete(finalWordsCount?: number): Promise<void>;
      },
    ): Promise<{ readonly id: number }> {
      let streamText = "";

      for await (const chunk of stream) {
        streamText += chunk;
      }

      const totalWords = streamText
        .trim()
        .split(/\s+/)
        .filter((value) => value !== "").length;

      await progressTracker?.begin({
        fragments: 1,
        words: totalWords,
      });
      await this.#document.serials.createWithId(serialId);
      await this.#document.serials.setTopologyReady(serialId);
      await this.#document.writeSummary(serialId, streamText.trim());
      await progressTracker?.complete(totalWords);

      digestMockState.generateCalls.push({
        options,
        serialId,
        streamText,
      });

      return { id: serialId };
    }
  },
}));

vi.mock("../../packages/core/src/facade/import.js", () => ({
  importSource: vi.fn(
    async (options: {
      readonly adapter: { readonly format: string };
      readonly document: DirectoryDocument;
      readonly extractionPrompt: string;
      readonly path: string;
      readonly userLanguage?: string;
    }) => {
      digestMockState.importCalls.push({
        adapterFormat: options.adapter.format,
        documentPath: options.document.path,
        extractionPrompt: options.extractionPrompt,
        path: options.path,
        userLanguage: options.userLanguage,
      });

      await options.document.openSession(async (document) => {
        await document.createSerial();
        await document.serials.setTopologyReady(1);
        await document.writeSummary(1, `${options.adapter.format} summary`);
        await document.writeBookMeta({
          authors: [],
          description: null,
          identifier: null,
          language: null,
          publishedAt: null,
          publisher: null,
          sourceFormat: options.adapter.format as "epub" | "txt" | "markdown",
          title: `${options.adapter.format} fixture`,
          version: 1,
        });
        await document.writeToc({
          items: [
            {
              children: [],
              serialId: 1,
              title: `${options.adapter.format} chapter`,
            },
          ],
          version: 1,
        });
      });
    },
  ),
}));

import {
  digestEpubSession,
  digestMarkdownSession,
  digestTextStreamSession,
  digestTxtSession,
} from "../../packages/core/src/facade/digest.js";
import { Language } from "../../packages/core/src/common/language.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/digest", () => {
  beforeEach(() => {
    digestMockState.generateCalls.length = 0;
    digestMockState.importCalls.length = 0;
    digestMockState.tempDocumentPaths.length = 0;
  });

  it("creates text-stream session documents and removes temporary directories by default", async () => {
    const title = await digestTextStreamSession(
      {
        bookLanguage: "fr",
        extractionPrompt: "Keep beats",
        llm: {} as never,
        stream: ["alpha ", "beta"],
        title: "  Digest Title  ",
        userLanguage: Language.SimplifiedChinese,
      },
      async (digest) => {
        expect(await digest.readMeta()).toMatchObject({
          language: "fr",
          sourceFormat: "txt",
          title: "Digest Title",
        });
        expect(await digest.readToc()).toStrictEqual({
          items: [
            {
              children: [],
              serialId: 1,
              title: "Digest Title",
            },
          ],
          version: 1,
        });

        return (await digest.readMeta())?.title;
      },
    );

    expect(title).toBe("Digest Title");
    expect(digestMockState.generateCalls).toStrictEqual([
      {
        options: {
          extractionPrompt: "Keep beats",
          userLanguage: Language.SimplifiedChinese,
        },
        serialId: 1,
        streamText: "alpha beta",
      },
    ]);
    expect(digestMockState.tempDocumentPaths).toHaveLength(1);
    await expect(
      access(digestMockState.tempDocumentPaths[0]!),
    ).rejects.toThrow();
  });

  it("keeps custom text-stream session directories and omits an empty toc title", async () => {
    await withTempDir("wikigraph-digest-", async (path) => {
      const documentDirPath = `${path}/custom-document`;

      await digestTextStreamSession(
        {
          bookLanguage: null,
          documentDirPath,
          extractionPrompt: "Keep beats",
          llm: {} as never,
          sourceFormat: "markdown",
          stream: ["single summary"],
          title: "   ",
        },
        async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            language: null,
            sourceFormat: "markdown",
            title: null,
          });
          expect(await digest.readToc()).toStrictEqual({
            items: [
              {
                children: [],
                serialId: 1,
              },
            ],
            version: 1,
          });
        },
      );
    });
  });

  it("emits discovered and progress events for text-stream digest", async () => {
    const events: Array<{
      readonly available?: boolean;
      readonly completedFragments?: number;
      readonly completedWords?: number;
      readonly serials?: readonly {
        readonly fragments?: number | undefined;
        readonly id: number;
        readonly words: number;
      }[];
      readonly id?: number;
      readonly totalWords?: number;
      readonly type: string;
    }> = [];

    await withTempDir("wikigraph-digest-", async () => {
      await digestTextStreamSession(
        {
          extractionPrompt: "Keep beats",
          llm: {} as never,
          onProgress: (event) => {
            switch (event.type) {
              case "serials-discovered":
                events.push({
                  available: event.available,
                  serials: event.serials,
                  type: event.type,
                });
                return;
              case "serial-progress":
                events.push({
                  completedFragments: event.completedFragments,
                  completedWords: event.completedWords,
                  id: event.id,
                  type: event.type,
                });
                return;
              case "digest-progress":
                events.push({
                  completedWords: event.completedWords,
                  totalWords: event.totalWords,
                  type: event.type,
                });
            }
          },
          stream: ["alpha beta"],
          title: "Progress Title",
        },
        () => undefined,
      );
    });

    expect(events).toStrictEqual([
      { available: false, serials: [], type: "serials-discovered" },
      {
        completedFragments: 1,
        completedWords: 2,
        id: 1,
        type: "serial-progress",
      },
      {
        completedWords: 2,
        type: "digest-progress",
        totalWords: 2,
      },
    ]);
  });

  it("routes source digest sessions through importSource with matching adapters", async () => {
    await withTempDir("wikigraph-digest-", async (path) => {
      const epubTitle = await digestEpubSession(
        {
          documentDirPath: `${path}/epub`,
          extractionPrompt: "Prompt",
          llm: {} as never,
          path: "/tmp/book.epub",
          userLanguage: Language.Japanese,
        },
        async (digest) => {
          return (await digest.readMeta())?.title;
        },
      );
      const markdownTitle = await digestMarkdownSession(
        {
          documentDirPath: `${path}/markdown`,
          extractionPrompt: "Prompt",
          llm: {} as never,
          path: "/tmp/book.md",
        },
        async (digest) => {
          return (await digest.readMeta())?.title;
        },
      );
      const txtTitle = await digestTxtSession(
        {
          documentDirPath: `${path}/txt`,
          extractionPrompt: "Prompt",
          llm: {} as never,
          path: "/tmp/book.txt",
        },
        async (digest) => {
          return (await digest.readMeta())?.title;
        },
      );

      expect([epubTitle, markdownTitle, txtTitle]).toStrictEqual([
        "epub fixture",
        "markdown fixture",
        "txt fixture",
      ]);
      expect(digestMockState.importCalls).toHaveLength(3);
      expect(digestMockState.importCalls[0]).toMatchObject({
        adapterFormat: "epub",
        extractionPrompt: "Prompt",
        path: "/tmp/book.epub",
        userLanguage: Language.Japanese,
      });
      expect(digestMockState.importCalls[0]?.documentPath).toContain("/epub");
      expect(digestMockState.importCalls[1]).toMatchObject({
        adapterFormat: "markdown",
        extractionPrompt: "Prompt",
        path: "/tmp/book.md",
        userLanguage: undefined,
      });
      expect(digestMockState.importCalls[1]?.documentPath).toContain(
        "/markdown",
      );
      expect(digestMockState.importCalls[2]).toMatchObject({
        adapterFormat: "txt",
        extractionPrompt: "Prompt",
        path: "/tmp/book.txt",
        userLanguage: undefined,
      });
      expect(digestMockState.importCalls[2]?.documentPath).toContain("/txt");
    });
  }, 15_000);
});
