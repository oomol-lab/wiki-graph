import { beforeEach, describe, expect, it, vi } from "vitest";

const archiveMockState = vi.hoisted(() => ({
  entityFindHits: [
    {
      chapter: 2,
      evidence: {
        shown: 1,
        sources: [
          {
            chapterId: 2,
            endSentenceIndex: 1,
            fragmentId: 0,
            id: "wikigraph://chapter/2/source/0#0..1",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 3,
      },
      field: "title",
      id: "wikigraph://entity/Q1",
      matchedTerms: ["rag"],
      position: { chapter: 2, fragment: 0 },
      score: 1,
      snippet: "RAG original source fragment.",
      title: "RAG",
      type: "entity",
    },
  ],
  findHits: [
    {
      chapter: 2,
      field: "content",
      id: "node:9",
      matchedTerms: ["rag"],
      position: { chapter: 2, fragment: 0 },
      score: 1,
      snippet: "RAG appears in this chunk.",
      title: "Retrieval design",
      type: "node",
    },
  ],
  index: {
    chapters: [
      {
        chapterId: 2,
        childCount: 0,
        depth: 0,
        fragmentCount: 1,
        stage: "graphed",
        title: "Chapter 2",
        tocPath: ["Chapter 2"],
      },
    ],
    edgeCount: 1,
    meta: {
      authors: [],
      description: null,
      identifier: null,
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "markdown",
      title: "Archive Fixture",
      version: 1,
    },
    nodeCount: 2,
    summaryCount: 0,
  },
  evidence: {
    items: [
      {
        chapterId: 2,
        endSentenceIndex: 1,
        fragmentId: 0,
        id: "wikigraph://chapter/2/source/0#0..1",
        source: "RAG original source fragment.",
        startSentenceIndex: 0,
        title: "Chapter 2",
        type: "source",
      },
    ],
    limit: 20,
    nextCursor: null,
  },
  listItems: [
    {
      id: "node:11",
      label: "Related",
      summary: "Related chunk",
      type: "node",
    },
  ],
  collection: {
    chapters: [2],
    ids: null,
    items: [
      {
        chapter: 2,
        field: "title",
        id: "wikigraph://entity/Q1",
        position: { chapter: 2, fragment: 0 },
        snippet: "1 mentions",
        title: "RAG",
        type: "entity",
      },
    ],
    limit: 20,
    nextCursor: null,
    order: "doc-asc",
    types: ["entity"],
  },
  page: {
    generatedNodeSummary: "RAG appears in this chunk.",
    id: "node:9",
    incoming: [],
    neighbors: [],
    outgoing: [],
    position: { chapter: 2, fragment: 0 },
    sourceFragments: [
      {
        id: "fragment:2:0",
        text: "RAG original source fragment.",
        truncated: false,
      },
    ],
    title: "Retrieval design",
    type: "node",
  },
  entityPage: {
    evidence: {
      shown: 1,
      sources: [
        {
          chapterId: 2,
          endSentenceIndex: 1,
          fragmentId: 0,
          id: "wikigraph://chapter/2/source/0#0..1",
          source: "RAG original source fragment.",
          startSentenceIndex: 0,
          title: "Chapter 2",
          type: "source",
        },
      ],
      total: 1,
    },
    id: "wikigraph://entity/Q1",
    label: "RAG",
    mentionCount: 1,
    qid: "Q1",
    type: "entity",
  },
  readCalls: [] as string[],
  textWrites: [] as string[],
}));

function parseJSONLLastLine(text: string | undefined): unknown {
  const line = text?.trim().split("\n").at(-1);

  if (line === undefined) {
    return undefined;
  }

  return JSON.parse(line) as unknown;
}

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async readDocument(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      archiveMockState.readCalls.push(this.#path);
      return await operation({});
    }
  },
}));

vi.mock("../../src/facade/index.js", () => ({
  estimateArchiveBuild: vi.fn(() =>
    Promise.resolve({
      estimatedCostUsd: { max: 0.02, min: 0.01 },
      estimatedLlmCalls: 1,
      estimatedTime: { maxSeconds: 120, minSeconds: 30 },
      estimatedTokens: { input: 1000, output: 200 },
      recommendation:
        "Estimate is low enough for an interactive build if the user expects LLM-backed work.",
      risk: "low",
      sourceWords: 500,
      targetStage: "summarized",
    }),
  ),
  findArchiveObjects: vi.fn(
    (
      _document: unknown,
      query: string,
      options: { readonly types?: readonly string[] },
    ) =>
      Promise.resolve({
        chapters: null,
        items:
          options.types?.includes("entity") === true
            ? archiveMockState.entityFindHits
            : archiveMockState.findHits,
        lens: "typed",
        lensHint: null,
        limit: 20,
        match: "any",
        nextCursor: null,
        order: "doc-asc",
        query,
        terms: [query.toLowerCase()],
        types: null,
      }),
  ),
  listArchiveEvidence: vi.fn(() => Promise.resolve(archiveMockState.evidence)),
  listArchiveCollection: vi.fn(() =>
    Promise.resolve(archiveMockState.collection),
  ),
  getArchiveIndex: vi.fn(() => Promise.resolve(archiveMockState.index)),
  listRelatedArchiveObjects: vi.fn(() =>
    Promise.resolve(archiveMockState.listItems),
  ),
  packArchiveContext: vi.fn(() =>
    Promise.resolve({
      anchor: archiveMockState.page,
      budget: 1000,
      links: [],
    }),
  ),
  readArchivePage: vi.fn((_document: unknown, id: string) =>
    Promise.resolve(
      id === "wikigraph://entity/Q1"
        ? archiveMockState.entityPage
        : archiveMockState.page,
    ),
  ),
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    archiveMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/convert.js", () => ({
  runConvertCommand: vi.fn(() => Promise.resolve()),
}));

import { runArchiveCommand } from "../../src/cli/archive.js";
import {
  findArchiveObjects,
  listArchiveEvidence,
  listArchiveCollection,
  listRelatedArchiveObjects,
  readArchivePage,
} from "../../src/facade/index.js";

describe("cli/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archiveMockState.readCalls.length = 0;
    archiveMockState.textWrites.length = 0;
  });

  it("prints an archive index", async () => {
    await runArchiveCommand({
      action: "index",
      archivePath: "/tmp/book.sdpub",
    });

    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(archiveMockState.textWrites[0]).toContain("Archive Type: LLM Wiki");
    expect(archiveMockState.textWrites[0]).toContain("chapter:2");
  });

  it("prints search hits as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "text",
      kinds: ["chunk"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain("wikigraph://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("Retrieval design");
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.sdpub",
      types: ["node"],
    });
  });

  it("passes entity search kinds to archive search", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "text",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.sdpub",
      types: ["entity"],
    });
    expect(archiveMockState.textWrites[0]).toContain("1 wikigraph://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("-- evidence 1/1");
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wikigraph://chapter/2/source/0#0..1 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain("2 evidence more...");
  });

  it("prints listed archive objects as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "wikigraph:///tmp/book.sdpub/chapter/2",
      format: "text",
      kinds: ["entity"],
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        chapters: [2],
        types: ["entity"],
      },
    );
    expect(archiveMockState.textWrites[0]).toContain("wikigraph://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("RAG");
  });

  it("prints search objects as JSON", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      nextCursor: null,
      objects: [
        {
          evidence: {
            shown: 1,
            sources: [
              {
                chapter: 2,
                fragment: 0,
                range: { end: 1, start: 0 },
                text: "RAG original source fragment.",
                type: "source",
                uri: "wikigraph://chapter/2/source/0#0..1",
              },
            ],
            total: 3,
          },
          label: "RAG",
          score: 1,
          summary: "RAG original source fragment.",
          type: "entity",
          uri: "wikigraph://entity/Q1",
        },
      ],
    });
  });

  it("prints search cursor metadata as JSONL", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "jsonl",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wikigraph://entity/Q1"',
    );
    expect(parseJSONLLastLine(archiveMockState.textWrites[0])).toStrictEqual({
      nextCursor: null,
      type: "page",
    });
  });

  it("gets an object by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "text",
      objectId: "wikigraph:///tmp/book.sdpub/chunk/9",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikigraph://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
  });

  it("gets an entity by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "json",
      objectId: "wikigraph:///tmp/book.sdpub/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikigraph://entity/Q1");
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual(
      archiveMockState.entityPage,
    );
  });

  it("prints related objects", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "text",
      objectId: "wikigraph:///tmp/book.sdpub/chunk/9",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith(
      {},
      "wikigraph://chunk/9",
    );
    expect(archiveMockState.textWrites[0]).toContain("wikigraph://chunk/11");
    expect(archiveMockState.textWrites[0]).toContain("Related");
  });

  it("prints evidence source ranges", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "text",
      objectId: "wikigraph:///tmp/book.sdpub/triple/Q1/mentions/Q2",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith(
      {},
      "wikigraph://triple/Q1/mentions/Q2",
      {},
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "wikigraph://chapter/2/source/0#0..1",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wikigraph://chapter/2/source/0#0..1 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "RAG original source fragment.",
    );
  });

  it("passes evidence pagination options", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikigraph:///tmp/book.sdpub",
      cursor: "cursor-1",
      format: "json",
      limit: 3,
      objectId: "wikigraph:///tmp/book.sdpub/entity/Q1",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith(
      {},
      "wikigraph://entity/Q1",
      {
        cursor: "cursor-1",
        limit: 3,
      },
    );
  });

  it("prints evidence as JSONL", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikigraph:///tmp/book.sdpub",
      format: "jsonl",
      objectId: "wikigraph:///tmp/book.sdpub/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"id":"wikigraph://chapter/2/source/0#0..1"',
    );
    expect(parseJSONLLastLine(archiveMockState.textWrites[0])).toStrictEqual({
      nextCursor: null,
      type: "page",
    });
  });

  it("prints a context pack", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wikigraph:///tmp/book.sdpub",
      budget: 1000,
      format: "text",
      objectId: "wikigraph:///tmp/book.sdpub/chunk/9",
    });

    expect(archiveMockState.textWrites[0]).toContain("Pack Budget: 1000");
    expect(archiveMockState.textWrites[0]).toContain("# Anchor");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
  });

  it("guides bare archive paths to Wiki Graph URI help", async () => {
    await expect(
      runArchiveCommand({
        action: "search",
        archivePath: "/tmp/book.sdpub",
        format: "json",
        query: "RAG",
      }),
    ).rejects.toThrow(
      "Example: wikigraph:///tmp/book.sdpub\nSee: wikigraph help uri",
    );
  });
});
