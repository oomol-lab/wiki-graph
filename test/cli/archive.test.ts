import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveFindHit,
  ArchivePage,
} from "../../src/facade/archive-view.js";

const archiveMockState = vi.hoisted(() => ({
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
            id: "wkg://chapter/2/source/0#0..1",
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
            id: "wkg://chapter/2/source/0#0..1",
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
        id: "wkg://chapter/2/source/0#0..1",
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
        id: "wkg://chapter/2/source/0#3..3",
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
      id: "wkg://triple/Q1/mentions/Q2",
      label: "RAG mentions agent",
      objectLabel: "agent",
      objectQid: "Q2",
      predicate: "mentions",
      subjectLabel: "RAG",
      subjectQid: "Q1",
      summary: "Q1 mentions Q2",
      type: "triple",
    },
  ],
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
    stage: "graphed",
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
    id: "wkg://state",
    state: {
      archive: {
        chapters: [],
        edgeCount: 1,
        meta: undefined,
        nodeCount: 2,
        summaryCount: 0,
      },
      kind: "archive",
    },
    title: "Archive state",
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
          id: "wkg://chapter/2/source/0#0..1",
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
  triplePage: {
    evidence: {
      nextCursor: null,
      shown: 2,
      sources: [
        {
          chapterId: 2,
          endSentenceIndex: 1,
          fragmentId: 0,
          id: "wkg://chapter/2/source/0#0..1",
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
          id: "wkg://chapter/2/source/0#3..3",
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
  readContinuationCursor: vi.fn(() =>
    Promise.resolve({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
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
        : id === "wkg://triple/Q1/mentions/Q2"
          ? archiveMockState.triplePage
          : id === "wkg://chapter/2"
            ? archiveMockState.chapterPage
            : id === "wkg://"
              ? archiveMockState.metaPage
              : id === "wkg://state"
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

  it("gets archive state", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub/state",
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/state",
    });

    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://state", {});
  });

  it("prints search hits as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      kinds: ["chunk"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain("wkg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("Retrieval design");
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.sdpub",
      types: ["node"],
    });
  });

  it("passes entity search kinds to archive search", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 3,
      format: "text",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.sdpub",
      evidenceLimit: 3,
      types: ["entity"],
    });
    expect(archiveMockState.textWrites[0]).toContain("1 wkg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("-- evidence 1/1");
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wkg://chapter/2/source/0#0..1 @@",
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
      archivePath: "wkg:///tmp/book.sdpub",
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
      archivePath: "wkg:///tmp/book.sdpub/chapter/2",
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

  it("creates collection continuation cursors for listed archive pages", async () => {
    vi.mocked(listArchiveCollection).mockResolvedValueOnce({
      ...archiveMockState.collection,
      nextCursor: "raw-collection-cursor",
    });

    await runArchiveCommand({
      action: "list",
      archivePath: "wkg:///tmp/book.sdpub/chapter/2",
      evidenceLimit: 3,
      format: "json",
      kinds: ["entity"],
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
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

  it("continues a listed archive page from a short cursor", async () => {
    vi.mocked(readContinuationCursor).mockResolvedValueOnce({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
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
      archivePath: "wkg:///tmp/book.sdpub/chapter/2",
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
                uri: "wkg://chapter/2/source/0#0..1",
              },
            ],
            total: 3,
          },
          label: "RAG",
          score: 1,
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
      archivePath: "wkg:///tmp/book.sdpub/chapter/2",
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
      archivePath: "wkg:///tmp/book.sdpub/chapter/2",
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
                uri: "wkg://chapter/2/source/0#0..1",
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
      archivePath: "wkg:///tmp/book.sdpub",
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
          score: 1,
          summary: "RAG original source fragment.",
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
        '      "score": 1',
        '      "summary": "RAG original source fragment."',
      ].join(",\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"evidence"');
  });

  it("prints search cursor metadata as JSONL", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wkg:///tmp/book.sdpub",
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
    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "", {
      archiveKey: "/tmp/book.sdpub",
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
      archiveKey: "/tmp/book.sdpub",
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
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 4,
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
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
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 4,
      format: "json",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
      cursor: "raw-next-evidence-cursor",
      format: "json",
      kind: "evidence",
      targetUri: "wkg://entity/Q1",
    });
  });

  it("gets an object by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/chunk/9",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://chunk/9", {});
    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
  });

  it("gets a chapter as a minimal object", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/chapter/2",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wkg://chapter/2", {});
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wkg://chapter/2",
      title: "Chapter 2",
      stage: "reading-graph",
    });
  });

  it("gets archive metadata from a root object URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/",
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
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 3,
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
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
            uri: "wkg://chapter/2/source/0#0..1",
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
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 1,
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "2 more evidence: wikigraph next c_more_evidence",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Next page:");
  });

  it("gets a triple as concise JSON", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub",
      evidenceLimit: 3,
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/triple/Q1/mentions/Q2",
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
            uri: "wkg://chapter/2/source/0#0..1",
          },
          {
            text: "Follow-up source fragment.",
            uri: "wkg://chapter/2/source/0#3..3",
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
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/chunk/9",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith({}, "wkg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("wkg://chunk/11");
    expect(archiveMockState.textWrites[0]).toContain("Related");
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "wkg://chunk/11",
        "Related",
        "Related chunk",
        "",
        "wkg://triple/Q1/mentions/Q2",
        "RAG(Q1) mentions agent(Q2)",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Q1 mentions Q2");
  });

  it("prints related triples as structured JSON", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 2,
      nextCursor: null,
      objects: [
        {
          label: "Related",
          summary: "Related chunk",
          type: "node",
          uri: "wkg://chunk/11",
        },
        {
          uri: "wkg://triple/Q1/mentions/Q2",
          predicate: "mentions",
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

  it("prints evidence source ranges", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/triple/Q1/mentions/Q2",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith(
      {},
      "wkg://triple/Q1/mentions/Q2",
      {},
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "wkg://chapter/2/source/0#0..1",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wkg://chapter/2/source/0#0..1 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "RAG original source fragment.",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "@@ wkg://chapter/2/source/0#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "@@ wkg://chapter/2/source/0#3..3 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
  });

  it("separates get evidence blocks with blank lines", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/triple/Q1/mentions/Q2",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      [
        "-- evidence 1/2",
        "@@ wkg://chapter/2/source/0#0..1 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "-- evidence 2/2",
        "@@ wkg://chapter/2/source/0#3..3 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
  });

  it("passes evidence pagination options", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.sdpub",
      cursor: "cursor-1",
      format: "json",
      limit: 3,
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith({}, "wkg://entity/Q1", {
      cursor: "cursor-1",
      limit: 3,
    });
  });

  it("creates evidence continuation cursors with the target URI", async () => {
    vi.mocked(listArchiveEvidence).mockResolvedValueOnce({
      ...archiveMockState.evidence,
      nextCursor: "raw-next-evidence-cursor",
    });

    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "json",
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
    });

    expect(createContinuationCursor).toHaveBeenCalledWith({
      archiveKey: "/tmp/book.sdpub",
      archivePath: "/tmp/book.sdpub",
      cursor: "raw-next-evidence-cursor",
      format: "json",
      kind: "evidence",
      targetUri: "wkg://entity/Q1",
    });
  });

  it("prints evidence as JSONL", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wkg:///tmp/book.sdpub",
      format: "jsonl",
      objectId: "wkg:///tmp/book.sdpub/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wkg://chapter/2/source/0#0..1"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"fragmentId"');
    expect(archiveMockState.textWrites[0]).not.toContain('"chapterId"');
    expect(parseJSONLLastLine(archiveMockState.textWrites[0])).toStrictEqual({
      nextCursor: null,
      type: "page",
    });
  });

  it("prints a context pack", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wkg:///tmp/book.sdpub",
      budget: 1000,
      format: "text",
      objectId: "wkg:///tmp/book.sdpub/chunk/9",
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
      "Example: wkg:///tmp/book.sdpub\nSee: wikigraph help uri",
    );
  });
});
