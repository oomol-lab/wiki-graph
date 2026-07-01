import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArchiveBacklinks,
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveFindHit,
  ArchiveListItem,
  ArchivePage,
} from "../../src/facade/archive-view.js";

const archiveMockState = vi.hoisted(() => ({
  backlinks: {
    chunks: {
      items: [
        {
          chapter: 2,
          field: "content",
          id: "node:9",
          position: { chapter: 2, fragment: 0, sentence: 0 },
          snippet: "RAG appears in this chunk.",
          title: "Retrieval design",
          type: "node",
        },
      ],
      limit: 1,
      nextCursor: null,
    },
    entities: {
      items: [
        {
          chapter: 2,
          field: "title",
          id: "wkg://entity/Q1",
          position: { chapter: 2, fragment: 0, sentence: 0 },
          score: 1,
          snippet: "1 mentions",
          title: "RAG",
          type: "entity",
        },
      ],
      limit: 1,
      nextCursor: null,
    },
    triples: {
      items: [
        {
          chapter: 2,
          field: "title",
          id: "wkg://triple/Q1/mentions/Q2",
          position: { chapter: 2, fragment: 0, sentence: 0 },
          score: 1,
          snippet: "RAG mentions agent",
          title: "Q1 mentions Q2",
          triple: {
            objectLabel: "agent",
            predicate: "mentions",
            subjectLabel: "RAG",
          },
          type: "triple",
        },
      ],
      limit: 1,
      nextCursor: null,
    },
  } satisfies ArchiveBacklinks,
  entityFindHits: [
    {
      chapter: 2,
      evidence: {
        nextCursor: null,
        shown: 1,
        sources: [
          {
            chapterId: 2,
            endSentenceIndex: 1,
            fragmentId: 0,
            id: "wkg://chapter/2/source#0..1",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 3,
      },
      field: "title",
      id: "wkg://entity/Q1",
      matchedTerms: ["rag"],
      position: { chapter: 2, fragment: 0 },
      score: 1,
      snippet: "RAG original source fragment.",
      title: "RAG",
      type: "entity",
    },
  ] satisfies ArchiveFindHit[],
  tripleFindHits: [
    {
      chapter: 2,
      evidence: {
        nextCursor: null,
        shown: 1,
        sources: [
          {
            chapterId: 2,
            endSentenceIndex: 1,
            fragmentId: 0,
            id: "wkg://chapter/2/source#0..1",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 1,
      },
      field: "title",
      id: "wkg://triple/Q1/mentions/Q2",
      position: { chapter: 2, fragment: 0 },
      snippet: "RAG mentions agent",
      title: "Q1 mentions Q2",
      triple: {
        objectLabel: "agent",
        predicate: "mentions",
        subjectLabel: "RAG",
      },
      type: "triple",
    },
  ] satisfies ArchiveFindHit[],
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
  sourceFindHits: [
    {
      chapter: 2,
      field: "source",
      id: "wkg://chapter/2/source#0..1",
      matchedTerms: ["rag"],
      position: { chapter: 2, fragment: 0 },
      score: 1,
      snippet:
        "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
      title: "Chapter 2",
      type: "source",
    },
  ] satisfies ArchiveFindHit[],
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
        id: "wkg://chapter/2/source#0..1",
        score: 2.5,
        source:
          "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
        startSentenceIndex: 0,
        title: "Chapter 2",
        type: "source",
      },
      {
        chapterId: 2,
        endSentenceIndex: 3,
        fragmentId: 0,
        id: "wkg://chapter/2/source#3",
        source: "Follow-up source fragment.",
        startSentenceIndex: 3,
        title: "Chapter 2",
        type: "source",
      },
    ],
    limit: 20,
    nextCursor: null,
  } satisfies ArchiveEvidence,
  listItems: [
    {
      id: "node:11",
      label: "Related",
      summary: "Related chunk",
      type: "node",
    },
    {
      evidence: {
        nextCursor: null,
        shown: 1,
        sources: [
          {
            chapterId: 2,
            endSentenceIndex: 1,
            fragmentId: 0,
            id: "wkg://chapter/2/source#0..1",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 1,
      },
      id: "wkg://triple/Q1/mentions/Q2",
      label: "RAG mentions agent",
      objectLabel: "agent",
      objectQid: "Q2",
      predicate: "mentions",
      score: 3.5,
      subjectLabel: "RAG",
      subjectQid: "Q1",
      summary: "Q1 mentions Q2",
      type: "triple",
    },
  ] satisfies ArchiveListItem[],
  collection: {
    chapters: [2],
    ids: null,
    items: [
      {
        chapter: 2,
        field: "title",
        id: "wkg://entity/Q1",
        position: { chapter: 2, fragment: 0 },
        snippet: "1 mentions",
        title: "RAG",
        type: "entity",
      },
    ],
    limit: 20,
    nextCursor: null,
    order: "doc-asc" as const,
    types: ["entity"] as const,
  } satisfies ArchiveCollectionResult,
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
  chapterPage: {
    id: "chapter:2",
    state: {
      "knowledge-graph": "missing",
      "reading-graph": "ready",
      "reading-summary": "missing",
      source: "ready",
    },
    title: "Chapter 2",
    type: "chapter",
  },
  metaPage: {
    authors: ["Archive Author"],
    description: "Archive description.",
    id: "meta:root",
    publisher: "Archive Press",
    title: "Archive Fixture",
    type: "meta",
  },
  statePage: {
    id: "wkg://chapter/2/state",
    state: {
      "knowledge-graph": "missing",
      "reading-graph": "ready",
      "reading-summary": "missing",
      source: "ready",
    },
    type: "state",
  },
  entityPage: {
    evidence: {
      nextCursor: null,
      shown: 1,
      sources: [
        {
          chapterId: 2,
          endSentenceIndex: 1,
          fragmentId: 0,
          id: "wkg://chapter/2/source#0..1",
          source: "RAG original source fragment.",
          startSentenceIndex: 0,
          title: "Chapter 2",
          type: "source",
        },
      ],
      total: 1,
    },
    id: "wkg://entity/Q1",
    label: "RAG",
    labels: [
      "RAG",
      "retrieval-augmented generation",
      "检索增强生成",
      "知识检索",
      "向量检索",
      "生成模型",
      "问答系统",
      "extra label",
    ],
    mentionCount: 1,
    qid: "Q1",
    type: "entity",
  } satisfies ArchivePage,
  entityWikipagePage: {
    en: {
      description: "Ming dynasty general",
      title: "Xu Da",
      url: "https://en.wikipedia.org/wiki/Xu_Da",
    },
    id: "wkg://entity/Q1/wikipage",
    type: "entity-wikipage",
    zh: {
      description: "明朝军事将领",
      title: "徐达",
      url: "https://zh.wikipedia.org/wiki/%E5%BE%90%E8%BE%BE",
    },
  } satisfies ArchivePage,
  sourceRangePage: {
    fragment: {
      fragmentId: 0,
      id: "wkg://chapter/2/source#0..1",
      preview: "RAG original source fragment.",
      sentenceCount: 2,
      text: "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
      wordsCount: 5,
    },
    id: "wkg://chapter/2/source#0..1",
    nextFragmentId: undefined,
    nodes: [],
    previousFragmentId: undefined,
    title: "wkg://chapter/2/source#0..1",
    type: "fragment",
  } satisfies ArchivePage,
  triplePage: {
    evidence: {
      nextCursor: null,
      shown: 2,
      sources: [
        {
          chapterId: 2,
          endSentenceIndex: 1,
          fragmentId: 0,
          id: "wkg://chapter/2/source#0..1",
          source:
            "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
          startSentenceIndex: 0,
          title: "Chapter 2",
          type: "source",
        },
        {
          chapterId: 2,
          endSentenceIndex: 3,
          fragmentId: 0,
          id: "wkg://chapter/2/source#3",
          source: "Follow-up source fragment.",
          startSentenceIndex: 3,
          title: "Chapter 2",
          type: "source",
        },
      ],
      total: 2,
    },
    id: "wkg://triple/Q1/mentions/Q2",
    label: "RAG(Q1) mentions agent(Q2)",
    objectQid: "Q2",
    predicate: "mentions",
    subjectQid: "Q1",
    type: "triple",
  } satisfies ArchivePage,
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
  createContinuationCursor: vi.fn(() => Promise.resolve("c_next")),
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
            : options.types?.includes("source") === true
              ? archiveMockState.sourceFindHits
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
    Promise.resolve({
      items: archiveMockState.listItems,
      limit: 20,
      nextCursor: null,
    }),
  ),
  packArchiveContext: vi.fn(() =>
    Promise.resolve({
      anchor: archiveMockState.page,
      budget: 1000,
      related: archiveMockState.listItems,
    }),
  ),
  readContinuationCursor: vi.fn(() =>
    Promise.resolve({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      cursor: "raw-search-cursor",
      format: "json",
      kind: "search",
      types: ["entity"],
    }),
  ),
  readArchivePage: vi.fn((_document: unknown, id: string) =>
    Promise.resolve(
      id === "wkg://entity/Q1"
        ? archiveMockState.entityPage
        : id === "wkg://entity/Q1/wikipage"
          ? archiveMockState.entityWikipagePage
          : id === "wkg://triple/Q1/mentions/Q2"
            ? archiveMockState.triplePage
            : id === "wkg://chapter/2"
              ? archiveMockState.chapterPage
              : id === "wkg://chapter/2/source#0..1"
                ? archiveMockState.sourceRangePage
                : id === "wkg://"
                  ? archiveMockState.metaPage
                  : id === "wkg://chapter/2/state"
                    ? archiveMockState.statePage
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
  createContinuationCursor,
  findArchiveObjects,
  listArchiveEvidence,
  listArchiveCollection,
  listRelatedArchiveObjects,
  readContinuationCursor,
  readArchivePage,
} from "../../src/facade/index.js";

describe("cli/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archiveMockState.readCalls.length = 0;
    archiveMockState.textWrites.length = 0;
  });

  it("gets chapter state", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg/chapter/2/state",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chapter/2/state",
    });

    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://chapter/2/state",
      {},
    );
  });

  it("prints search hits as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      kinds: ["chunk"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain("wkg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("Retrieval design");
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      types: ["node"],
    });
  });

  it("prints source search hits as citation blocks", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      context: 0,
      format: "text",
      kinds: ["source"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      sourceContext: 0,
      types: ["source"],
    });
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "@@ wkg://chapter/2/source#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Chapter 2");
  });

  it("passes entity search kinds to archive search", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "text",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      evidenceLimit: 3,
      types: ["entity"],
    });
    expect(archiveMockState.textWrites[0]).toContain("wkg://entity/Q1");
    expect(archiveMockState.textWrites[0]).not.toContain("1 wkg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("-- evidence 1/1");
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wkg://chapter/2/source#0..1 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain("2 evidence more...");
  });

  it("prints text search continuation commands", async () => {
    const [entityHit] = archiveMockState.entityFindHits;

    if (entityHit === undefined) {
      throw new Error("Missing entity fixture.");
    }

    vi.mocked(createContinuationCursor)
      .mockResolvedValueOnce("c_more_evidence")
      .mockResolvedValueOnce("c_more_results");
    vi.mocked(findArchiveObjects).mockResolvedValueOnce({
      chapters: null,
      items: [
        {
          ...entityHit,
          evidence: {
            ...entityHit.evidence,
            nextCursor: "raw-next-evidence-cursor",
          },
        },
      ],
      lens: "typed",
      lensHint: null,
      limit: 20,
      match: "any",
      nextCursor: "raw-next-search-cursor",
      order: "doc-asc",
      query: "RAG",
      terms: ["rag"],
      types: null,
    });

    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 1,
      format: "text",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "2 more evidence: wikigraph next c_more_evidence",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Next page: wikigraph next c_more_results",
    );
  });

  it("prints listed archive objects as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
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
    expect(archiveMockState.textWrites[0]).toContain("wkg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("RAG");
  });

  it("passes backlinks to listed source objects", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      items: [
        {
          ...archiveMockState.sourceFindHits[0]!,
          backlinks: archiveMockState.backlinks,
        },
      ],
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/source",
      backlinks: true,
      format: "json",
      kinds: ["source"],
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        backlinks: true,
        types: ["source"],
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      objects: [
        {
          backlinks: {
            chunks: { objects: [{ uri: "wkg://chunk/9" }] },
            entities: { objects: [{ uri: "wkg://entity/Q1" }] },
            triples: { objects: [{ uri: "wkg://triple/Q1/mentions/Q2" }] },
          },
          uri: "wkg://chapter/2/source#0..1",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).not.toContain('"type": "source"');
  });

  it("creates collection continuation cursors for listed archive pages", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      nextCursor: "raw-collection-cursor",
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 3,
      format: "json",
      kinds: ["entity"],
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      chapters: [2],
      cursor: "raw-collection-cursor",
      evidenceLimit: 3,
      format: "json",
      ids: null,
      kind: "collection",
      order: "doc-asc",
      types: ["entity"],
    });
  });

  it("preserves backlinks on collection continuation cursors", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      nextCursor: "raw-collection-cursor",
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/source",
      backlinks: true,
      format: "json",
      kinds: ["source"],
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      backlinks: true,
      chapters: null,
      cursor: "raw-collection-cursor",
      format: "json",
      ids: null,
      kind: "collection",
      order: "doc-asc",
      types: ["source"],
    });
  });

  it("streams every listed archive page with --all jsonl", async () => {
    vi.mocked(listArchiveCollection)
      .mockResolvedValueOnce({
        ...archiveMockState.collection,
        items: [
          {
            field: "title",
            id: "chapter:1",
            position: { chapter: 1 },
            state: {
              "knowledge-graph": "missing",
              "reading-graph": "ready",
              "reading-summary": "ready",
              source: "ready",
            },
            snippet: "Chapter 1",
            title: "Chapter 1",
            type: "chapter",
          },
        ],
        nextCursor: "raw-collection-cursor",
      })
      .mockResolvedValueOnce({
        ...archiveMockState.collection,
        items: [
          {
            field: "title",
            id: "chapter:2",
            position: { chapter: 2 },
            state: {
              "knowledge-graph": "missing",
              "reading-graph": "ready",
              "reading-summary": "missing",
              source: "ready",
            },
            snippet: "Chapter 2",
            title: "Chapter 2",
            type: "chapter",
          },
        ],
        nextCursor: null,
      });

    await runArchiveCommand({
      action: "list",
      all: true,
      archivePath: "wkg:///tmp/book.wikg/chapter",
      format: "jsonl",
      kinds: ["chapter"],
      limit: 1,
    });

    expect(listArchiveCollection).toHaveBeenNthCalledWith(
      1,
      {},
      {
        limit: 1,
        types: ["chapter"],
      },
    );
    expect(listArchiveCollection).toHaveBeenNthCalledWith(
      2,
      {},
      {
        cursor: "raw-collection-cursor",
        limit: 1,
        types: ["chapter"],
      },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain('"uri":"wkg://chapter/1"');
    expect(archiveMockState.textWrites[1]).toContain('"uri":"wkg://chapter/2"');
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"page"');
    expect(archiveMockState.textWrites[1]).not.toContain('"type":"page"');
  });

  it("continues a listed archive page from a short cursor", async () => {
    vi.mocked(readContinuationCursor).mockResolvedValueOnce({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      chapters: [2],
      cursor: "raw-collection-cursor",
      format: "json",
      ids: null,
      kind: "collection",
      order: "doc-asc",
      types: ["entity"],
    });

    await runArchiveCommand({
      action: "next",
      archivePath: "c_next",
      format: "json",
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        chapters: [2],
        cursor: "raw-collection-cursor",
        limit: 20,
        order: "doc-asc",
        types: ["entity"],
      },
    );
    expect(findArchiveObjects).not.toHaveBeenCalled();
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          uri: "wkg://entity/Q1",
        },
      ],
    });
  });

  it("prints listed entity evidence when requested", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      items: archiveMockState.entityFindHits,
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 3,
      format: "json",
      kinds: ["entity"],
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        chapters: [2],
        evidenceLimit: 3,
        types: ["entity"],
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          evidence: {
            nextCursor: null,
            shown: 1,
            sources: [
              {
                text: "RAG original source fragment.",
                uri: "wkg://chapter/2/source#0..1",
              },
            ],
            total: 3,
          },
          label: "RAG",
          type: "entity",
          uri: "wkg://entity/Q1",
        },
      ],
    });
  });

  it("keeps listed object evidence disabled with evidence zero", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 0,
      format: "json",
      kinds: ["entity"],
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        chapters: [2],
        types: ["entity"],
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          label: "RAG",
          type: "entity",
          uri: "wkg://entity/Q1",
        },
      ],
    });
  });

  it("keeps nested evidence cursors separate from collection cursors", async () => {
    const entityFindHit = archiveMockState.entityFindHits[0]!;

    vi.mocked(createContinuationCursor)
      .mockResolvedValueOnce("c_evidence")
      .mockResolvedValueOnce("c_collection");
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      items: [
        {
          ...entityFindHit,
          evidence: {
            ...entityFindHit.evidence,
            nextCursor: "raw-evidence-cursor",
          },
        },
      ],
      nextCursor: "raw-collection-cursor",
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 1,
      format: "json",
      kinds: ["entity"],
    });

    expect(createContinuationCursor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: "raw-evidence-cursor",
        kind: "evidence",
        targetUri: "wkg://entity/Q1",
      }),
    );
    expect(createContinuationCursor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chapters: [2],
        cursor: "raw-collection-cursor",
        kind: "collection",
      }),
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      nextCursor: "c_collection",
      objects: [
        {
          evidence: {
            nextCursor: "c_evidence",
          },
        },
      ],
    });
  });

  it("prints listed triple evidence as structured JSON when requested", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      items: archiveMockState.tripleFindHits,
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 3,
      format: "json",
      kinds: ["triple"],
    });

    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      {
        chapters: [2],
        evidenceLimit: 3,
        types: ["triple"],
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          evidence: {
            nextCursor: null,
            shown: 1,
            sources: [
              {
                text: "RAG original source fragment.",
                uri: "wkg://chapter/2/source#0..1",
              },
            ],
            total: 1,
          },
          objectLabel: "agent",
          predicate: "mentions",
          subjectLabel: "RAG",
          uri: "wkg://triple/Q1/mentions/Q2",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"triple"');
    expect(archiveMockState.textWrites[0]).not.toContain('"label":"Q1');
    expect(archiveMockState.textWrites[0]).not.toContain('"summary"');
  });

  it("prints search objects as JSON", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          label: "RAG",
          type: "entity",
          uri: "wkg://entity/Q1",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).toContain(
      [
        '      "uri": "wkg://entity/Q1"',
        '      "type": "entity"',
        '      "label": "RAG"',
      ].join(",\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"score"');
    expect(archiveMockState.textWrites[0]).not.toContain('"snippet"');
    expect(archiveMockState.textWrites[0]).not.toContain('"summary"');
    expect(archiveMockState.textWrites[0]).not.toContain('"evidence"');
  });

  it("prints searched triple evidence when requested", async () => {
    vi.mocked(findArchiveObjects).mockResolvedValueOnce({
      chapters: null,
      items: archiveMockState.tripleFindHits,
      lens: "typed",
      lensHint: null,
      limit: 20,
      match: "any",
      nextCursor: null,
      order: "doc-asc",
      query: "RAG",
      terms: ["rag"],
      types: null,
    });

    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "json",
      kinds: ["triple"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      evidenceLimit: 3,
      types: ["triple"],
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          evidence: {
            nextCursor: null,
            shown: 1,
            sources: [
              {
                text: "RAG original source fragment.",
                uri: "wkg://chapter/2/source#0..1",
              },
            ],
            total: 1,
          },
          objectLabel: "agent",
          predicate: "mentions",
          subjectLabel: "RAG",
          uri: "wkg://triple/Q1/mentions/Q2",
        },
      ],
    });
  });

  it("passes backlinks to searched source objects", async () => {
    vi.mocked(findArchiveObjects).mockResolvedValueOnce({
      chapters: null,
      items: [
        {
          ...archiveMockState.sourceFindHits[0]!,
          backlinks: archiveMockState.backlinks,
        },
      ],
      lens: "typed",
      lensHint: null,
      limit: 20,
      match: "any",
      nextCursor: null,
      order: "doc-asc",
      query: "RAG",
      terms: ["rag"],
      types: null,
    });

    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg/source",
      backlinks: true,
      format: "json",
      kinds: ["source"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      backlinks: true,
      types: ["source"],
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      objects: [
        {
          backlinks: {
            chunks: { objects: [{ uri: "wkg://chunk/9" }] },
            entities: { objects: [{ uri: "wkg://entity/Q1" }] },
            triples: { objects: [{ uri: "wkg://triple/Q1/mentions/Q2" }] },
          },
          uri: "wkg://chapter/2/source#0..1",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).not.toContain('"type": "source"');
  });

  it("prints search cursor metadata as JSONL", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      format: "jsonl",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain('"uri":"wkg://entity/Q1"');
    expect(parseJSONLLastLine(archiveMockState.textWrites[0])).toStrictEqual({
      nextCursor: null,
      type: "page",
    });
  });

  it("continues a result page from a short cursor", async () => {
    await runArchiveCommand({
      action: "next",
      archivePath: "c_next",
      format: "json",
    });

    expect(readContinuationCursor).toHaveBeenCalledWith("c_next");
    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "", {
      archiveKey: "/tmp/book.wikg",
      cursor: "raw-search-cursor",
      limit: 20,
      types: ["entity"],
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          uri: "wkg://entity/Q1",
        },
      ],
    });
  });

  it("uses the next command limit instead of cursor state", async () => {
    await runArchiveCommand({
      action: "next",
      archivePath: "c_next",
      format: "json",
      limit: 7,
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "", {
      archiveKey: "/tmp/book.wikg",
      cursor: "raw-search-cursor",
      limit: 7,
      types: ["entity"],
    });
  });

  it("preserves evidence preview limits on search continuation cursors", async () => {
    vi.mocked(findArchiveObjects).mockResolvedValueOnce({
      chapters: null,
      items: archiveMockState.entityFindHits,
      lens: "typed",
      lensHint: null,
      limit: 20,
      match: "any",
      nextCursor: "raw-next-search-cursor",
      order: "doc-asc",
      query: "RAG",
      terms: ["rag"],
      types: null,
    });

    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 4,
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      cursor: "raw-next-search-cursor",
      evidenceLimit: 4,
      format: "json",
      kind: "search",
      types: ["entity"],
    });
  });

  it("uses evidence preview limits for embedded evidence cursors", async () => {
    const [entityHit] = archiveMockState.entityFindHits;

    if (entityHit === undefined) {
      throw new Error("Missing entity fixture.");
    }

    vi.mocked(findArchiveObjects).mockResolvedValueOnce({
      chapters: null,
      items: [
        {
          ...entityHit,
          evidence: {
            ...entityHit.evidence,
            nextCursor: "raw-next-evidence-cursor",
          },
        },
      ],
      lens: "typed",
      lensHint: null,
      limit: 20,
      match: "any",
      nextCursor: null,
      order: "doc-asc",
      query: "RAG",
      terms: ["rag"],
      types: null,
    });

    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 4,
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      cursor: "raw-next-evidence-cursor",
      format: "json",
      kind: "evidence",
      targetUri: "wkg://entity/Q1",
    });
  });

  it("gets an object by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chunk/9",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://chunk/9", {});
    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
  });

  it("gets a chapter as a minimal object", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chapter/2",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://chapter/2", {});
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wkg://chapter/2",
      title: "Chapter 2",
      state: {
        "knowledge-graph": "missing",
        "reading-graph": "ready",
        "reading-summary": "missing",
        source: "ready",
      },
    });
    expect(archiveMockState.textWrites[0]).toContain(
      '"title": "Chapter 2",\n  "state":',
    );
  });

  it("gets a chapter as one text line with state", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chapter/2",
    });

    expect(archiveMockState.textWrites[0]).toBe(
      "wkg://chapter/2  Chapter 2  source:ready reading-graph:ready reading-summary:missing knowledge-graph:missing\n",
    );
  });

  it("gets a source range as a citation block", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chapter/2/source#0..1",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://chapter/2/source#0..1",
      {},
    );
    expect(archiveMockState.textWrites[0]).toBe(
      [
        "@@ wkg://chapter/2/source#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Words:");
    expect(archiveMockState.textWrites[0]).not.toContain("Previous:");
    expect(archiveMockState.textWrites[0]).not.toContain("Next:");
    expect(archiveMockState.textWrites[0]).not.toContain("Related Nodes:");
  });

  it("prints source range backlinks when requested", async () => {
    vi.mocked(readArchivePage).mockResolvedValueOnce({
      ...archiveMockState.sourceRangePage,
      backlinks: archiveMockState.backlinks,
    });

    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      backlinks: true,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chapter/2/source#0..1",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://chapter/2/source#0..1",
      { backlinks: true },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      backlinks: {
        chunks: {
          nextCursor: null,
          objects: [{ uri: "wkg://chunk/9" }],
        },
        entities: {
          nextCursor: null,
          objects: [{ uri: "wkg://entity/Q1" }],
        },
        triples: {
          nextCursor: null,
          objects: [{ uri: "wkg://triple/Q1/mentions/Q2" }],
        },
      },
      uri: "wkg://chapter/2/source#0..1",
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).not.toHaveProperty(
      "type",
    );
  });

  it("prints text source backlinks without adding backlinks to evidence sources", async () => {
    vi.mocked(readArchivePage).mockResolvedValueOnce({
      ...archiveMockState.sourceRangePage,
      backlinks: archiveMockState.backlinks,
    });

    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      backlinks: true,
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chapter/2/source#0..1",
    });

    expect(archiveMockState.textWrites[0]).toContain("Backlinks:");
    expect(archiveMockState.textWrites[0]).toContain("wkg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("wkg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain(
      "wkg://triple/Q1/mentions/Q2",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "RAG(Q1) mentions agent(Q2)",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Chunks:");
    expect(archiveMockState.textWrites[0]).not.toContain("Entities:");
    expect(archiveMockState.textWrites[0]).not.toContain("Triples:");
    expect(archiveMockState.textWrites[0]).not.toContain("[none]");
    expect(archiveMockState.textWrites[0]).not.toContain("-- evidence");
  });

  it("gets archive metadata from a root object URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://", {});
    expect(archiveMockState.textWrites[0]).toBe(
      [
        "uri: wkg://",
        "title: Archive Fixture",
        "authors: Archive Author",
        "publisher: Archive Press",
        "description: Archive description.",
        "",
      ].join("\n"),
    );
  });

  it("gets an entity by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://entity/Q1", {
      evidenceLimit: 3,
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wkg://entity/Q1",
      labels: [
        "RAG",
        "retrieval-augmented generation",
        "检索增强生成",
        "知识检索",
        "向量检索",
        "生成模型",
        "问答系统",
      ],
      qid: "Q1",
      evidence: {
        nextCursor: null,
        shown: 1,
        sources: [
          {
            uri: "wkg://chapter/2/source#0..1",
            text: "RAG original source fragment.",
          },
        ],
        total: 1,
      },
    });
    expect(archiveMockState.textWrites[0]).toContain(
      ['  "uri": "wkg://entity/Q1",', '  "labels": [', '    "RAG",'].join("\n"),
    );
  });

  it("gets an entity wikipage by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1/wikipage",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://entity/Q1/wikipage",
      {},
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      en: {
        description: "Ming dynasty general",
        title: "Xu Da",
        url: "https://en.wikipedia.org/wiki/Xu_Da",
      },
      uri: "wkg://entity/Q1/wikipage",
      zh: {
        description: "明朝军事将领",
        title: "徐达",
        url: "https://zh.wikipedia.org/wiki/%E5%BE%90%E8%BE%BE",
      },
    });
    expect(archiveMockState.textWrites[0]).not.toContain('"qid"');
  });

  it("prints text entity wikipage pages with the URI first", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/entity/Q1/wikipage",
    });

    expect(archiveMockState.textWrites[0]).toBe(
      [
        "wkg://entity/Q1/wikipage",
        "",
        "徐达  https://zh.wikipedia.org/wiki/%E5%BE%90%E8%BE%BE",
        "明朝军事将领",
        "",
        "Xu Da  https://en.wikipedia.org/wiki/Xu_Da",
        "Ming dynasty general",
        "",
      ].join("\n"),
    );
  });

  it("disables single-object evidence with evidence zero", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 0,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://entity/Q1", {});
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      labels: [
        "RAG",
        "retrieval-augmented generation",
        "检索增强生成",
        "知识检索",
        "向量检索",
        "生成模型",
        "问答系统",
      ],
      qid: "Q1",
      uri: "wkg://entity/Q1",
    });
  });

  it("hides text get evidence with evidence zero", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 0,
      format: "text",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://entity/Q1", {});
    expect(archiveMockState.textWrites[0]).toBe(
      [
        "wkg://entity/Q1",
        "RAG",
        "",
        "Next:",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1 evidence",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1 related",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1/wikipage get",
        "",
      ].join("\n"),
    );
  });

  it("defaults evidence for chapter-scoped entity pages", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chapter/2/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://chapter/2/entity/Q1",
      { evidenceLimit: 3 },
    );
  });

  it("prints text get evidence continuation commands", async () => {
    vi.mocked(createContinuationCursor).mockResolvedValueOnce(
      "c_more_evidence",
    );
    vi.mocked(readArchivePage).mockResolvedValueOnce({
      ...archiveMockState.entityPage,
      evidence: Object.assign({}, archiveMockState.entityPage.evidence, {
        nextCursor: "raw-next-evidence-cursor",
        total: 3,
      }),
    });

    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 1,
      format: "text",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "2 more evidence: wikigraph next c_more_evidence",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Mentions:");
    expect(archiveMockState.textWrites[0]).not.toContain("Next page:");
  });

  it("prints entity investigation next steps in text get output", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      [
        "Next:",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1 evidence",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1 related",
        "  wikigraph wkg:///tmp/book.wikg/entity/Q1/wikipage get",
      ].join("\n"),
    );
  });

  it("gets a triple as concise JSON", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    const output = JSON.parse(archiveMockState.textWrites[0] ?? "") as Record<
      string,
      unknown
    >;

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wkg://triple/Q1/mentions/Q2",
      { evidenceLimit: 3 },
    );
    expect(output).toStrictEqual({
      evidence: {
        nextCursor: null,
        shown: 2,
        sources: [
          {
            text: "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
            uri: "wkg://chapter/2/source#0..1",
          },
          {
            text: "Follow-up source fragment.",
            uri: "wkg://chapter/2/source#3",
          },
        ],
        total: 2,
      },
      label: "RAG(Q1) mentions agent(Q2)",
      uri: "wkg://triple/Q1/mentions/Q2",
    });
    expect(output).not.toHaveProperty("id");
    expect(output).not.toHaveProperty("subjectQid");
    expect(output).not.toHaveProperty("predicate");
    expect(output).not.toHaveProperty("objectQid");
  });

  it("prints related objects", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chunk/9",
      query: "agent",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith(
      {},
      "wkg://chunk/9",
      { query: "agent" },
    );
    expect(archiveMockState.textWrites[0]).toContain("wkg://chunk/11");
    expect(archiveMockState.textWrites[0]).toContain("Related");
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "wkg://chunk/11",
        "Related",
        "",
        "score: 3.5",
        "wkg://triple/Q1/mentions/Q2",
        "RAG(Q1) mentions agent(Q2)",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Related chunk");
    expect(archiveMockState.textWrites[0]).not.toContain("Q1 mentions Q2");
  });

  it("prints related triples as structured JSON", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wkg:///tmp/book.wikg",
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          label: "Related",
          type: "node",
          uri: "wkg://chunk/11",
        },
        {
          uri: "wkg://triple/Q1/mentions/Q2",
          predicate: "mentions",
          score: 3.5,
          subjectLabel: "RAG",
          objectLabel: "agent",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).toContain(
      [
        '      "uri": "wkg://triple/Q1/mentions/Q2",',
        '      "predicate": "mentions",',
        '      "subjectLabel": "RAG",',
        '      "objectLabel": "agent"',
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"summary":"Q1');
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"triple"');
    expect(archiveMockState.textWrites[0]).not.toContain(
      '"label":"RAG mentions agent"',
    );
  });

  it("passes related role and prints related triple evidence", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wkg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
      role: "subject",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith(
      {},
      "wkg://entity/Q1",
      {
        evidenceLimit: 3,
        role: "subject",
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      objects: [
        {
          uri: "wkg://chunk/11",
        },
        {
          evidence: {
            shown: 1,
            sources: [
              {
                uri: "wkg://chapter/2/source#0..1",
              },
            ],
            total: 1,
          },
          uri: "wkg://triple/Q1/mentions/Q2",
        },
      ],
    });
  });

  it("streams every related page with --all jsonl", async () => {
    vi.mocked(listRelatedArchiveObjects)
      .mockResolvedValueOnce({
        items: [archiveMockState.listItems[0]!] satisfies ArchiveListItem[],
        limit: 1,
        nextCursor: "1",
      })
      .mockResolvedValueOnce({
        items: [archiveMockState.listItems[1]!] satisfies ArchiveListItem[],
        limit: 1,
        nextCursor: null,
      });

    await runArchiveCommand({
      action: "related",
      all: true,
      archivePath: "wkg:///tmp/book.wikg",
      format: "jsonl",
      limit: 1,
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
      role: "subject",
    });

    expect(listRelatedArchiveObjects).toHaveBeenNthCalledWith(
      1,
      {},
      "wkg://entity/Q1",
      { limit: 1, role: "subject" },
    );
    expect(listRelatedArchiveObjects).toHaveBeenNthCalledWith(
      2,
      {},
      "wkg://entity/Q1",
      { cursor: "1", limit: 1, role: "subject" },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain('"uri":"wkg://chunk/11"');
    expect(archiveMockState.textWrites[1]).toContain(
      '"uri":"wkg://triple/Q1/mentions/Q2"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"page"');
    expect(archiveMockState.textWrites[1]).not.toContain('"type":"page"');
  });

  it("prints evidence source ranges", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith(
      {},
      "wkg://triple/Q1/mentions/Q2",
      {},
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "wkg://chapter/2/source#0..1",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wkg://chapter/2/source#0..1 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "RAG original source fragment.",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "@@ wkg://chapter/2/source#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "@@ wkg://chapter/2/source#3 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "score: 2.5\n@@ wkg://chapter/2/source#0..1 @@",
    );
  });

  it("separates get evidence blocks with blank lines", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.wikg",
      format: "text",
      objectId: "wkg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      [
        "-- evidence 1/2",
        "@@ wkg://chapter/2/source#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "-- evidence 2/2",
        "@@ wkg://chapter/2/source#3 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
  });

  it("passes evidence pagination options", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.wikg",
      context: 1,
      cursor: "cursor-1",
      format: "json",
      limit: 3,
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
      query: "paragraph",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith({}, "wkg://entity/Q1", {
      cursor: "cursor-1",
      limit: 3,
      query: "paragraph",
      sourceContext: 1,
    });
    expect(archiveMockState.textWrites[0]).toContain('"score": 2.5');
  });

  it("creates evidence continuation cursors with the target URI", async () => {
    vi.mocked(listArchiveEvidence).mockResolvedValueOnce({
      ...archiveMockState.evidence,
      nextCursor: "raw-next-evidence-cursor",
    });

    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.wikg",
      context: 0,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
      query: "paragraph",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.wikg",
      archivePath: "/tmp/book.wikg",
      cursor: "raw-next-evidence-cursor",
      format: "json",
      kind: "evidence",
      query: "paragraph",
      sourceContext: 0,
      targetUri: "wkg://entity/Q1",
    });
  });

  it("prints evidence as JSONL", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.wikg",
      format: "jsonl",
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wkg://chapter/2/source#0..1"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"fragmentId"');
    expect(archiveMockState.textWrites[0]).not.toContain('"chapterId"');
    expect(parseJSONLLastLine(archiveMockState.textWrites[0])).toStrictEqual({
      nextCursor: null,
      type: "page",
    });
  });

  it("streams every evidence page with --all jsonl", async () => {
    vi.mocked(listArchiveEvidence)
      .mockResolvedValueOnce({
        ...archiveMockState.evidence,
        items: [archiveMockState.evidence.items[0]!],
        limit: 1,
        nextCursor: "raw-next-evidence-cursor",
      })
      .mockResolvedValueOnce({
        ...archiveMockState.evidence,
        items: [archiveMockState.evidence.items[1]!],
        limit: 1,
        nextCursor: null,
      });

    await runArchiveCommand({
      action: "evidence",
      all: true,
      archivePath: "wkg:///tmp/book.wikg",
      format: "jsonl",
      limit: 1,
      objectId: "wkg:///tmp/book.wikg/entity/Q1",
    });

    expect(listArchiveEvidence).toHaveBeenNthCalledWith(
      1,
      {},
      "wkg://entity/Q1",
      { limit: 1 },
    );
    expect(listArchiveEvidence).toHaveBeenNthCalledWith(
      2,
      {},
      "wkg://entity/Q1",
      { cursor: "raw-next-evidence-cursor", limit: 1 },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wkg://chapter/2/source#0..1"',
    );
    expect(archiveMockState.textWrites[1]).toContain(
      '"uri":"wkg://chapter/2/source#3"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"page"');
    expect(archiveMockState.textWrites[1]).not.toContain('"type":"page"');
  });

  it("prints a context pack", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wkg:///tmp/book.wikg",
      budget: 1000,
      format: "text",
      objectId: "wkg:///tmp/book.wikg/chunk/9",
    });

    expect(archiveMockState.textWrites[0]).toContain("Pack Budget: 1000");
    expect(archiveMockState.textWrites[0]).toContain("# Anchor");
    expect(archiveMockState.textWrites[0]).toContain("# Related");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
    expect(archiveMockState.textWrites[0]).toContain(
      ["# Related", "wkg://chunk/11", "Related", "", "score: 3.5"].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "wkg://triple/Q1/mentions/Q2",
        "RAG(Q1) mentions agent(Q2)",
        "",
        "-- evidence 1/1",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("# Links");
  });

  it("preserves evidence zero for pack output", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wkg:///tmp/book.wikg",
      budget: 1000,
      evidenceLimit: 0,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chunk/9",
    });

    expect(archiveMockState.textWrites[0]).not.toContain('"evidence"');
  });

  it("prints a context pack as anchor plus related JSON", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wkg:///tmp/book.wikg",
      budget: 1000,
      format: "json",
      objectId: "wkg:///tmp/book.wikg/chunk/9",
    });

    const output = JSON.parse(archiveMockState.textWrites[0] ?? "") as Record<
      string,
      unknown
    >;

    expect(output).toMatchObject({
      anchor: {
        uri: "wkg://chunk/9",
      },
      related: {
        limit: 2,
        nextCursor: null,
        objects: [
          {
            uri: "wkg://chunk/11",
          },
          {
            evidence: {
              shown: 1,
            },
            uri: "wkg://triple/Q1/mentions/Q2",
          },
        ],
      },
    });
    expect(output).not.toHaveProperty("links");
    expect(output).not.toHaveProperty("budget");
  });

  it("guides bare archive paths to Wiki Graph URI help", async () => {
    await expect(
      runArchiveCommand({
        action: "search",
        archivePath: "/tmp/book.wikg",
        format: "json",
        query: "RAG",
      }),
    ).rejects.toThrow("Example: wkg:///tmp/book.wikg\nSee: wikigraph help uri");
  });
});
