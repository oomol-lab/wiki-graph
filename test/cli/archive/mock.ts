import { vi } from "vitest";
import type * as CLISupport from "../../../packages/cli/src/support/index.js";
import type {
  ArchiveBacklinks,
  ArchiveCollectionResult,
  ArchiveEvidence,
  ArchiveFindHit,
  ArchiveListItem,
  ArchivePage,
} from "../../../packages/core/src/retrieval/query/view.js";

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
          id: "wikg://entity/Q1",
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
          id: "wikg://triple/Q1/mentions/Q2",
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
            id: "wikg://chapter/2/source#1..2",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 3,
      },
      field: "title",
      id: "wikg://entity/Q1",
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
            id: "wikg://chapter/2/source#1..2",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 1,
      },
      field: "title",
      id: "wikg://triple/Q1/mentions/Q2",
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
  ftsCurrent: false,
  ftsEmbedded: false,
  inspectChapters: [
    {
      chapterId: 1,
      childCount: 0,
      depth: 0,
      fragmentCount: 1,
      stage: "summarized",
      title: "Ready chapter",
      tocPath: ["Ready chapter"],
      words: 800,
    },
    {
      chapterId: 2,
      childCount: 0,
      depth: 0,
      fragmentCount: 1,
      stage: "sourced",
      title: "Missing chapter",
      tocPath: ["Missing chapter"],
      words: 400,
    },
    {
      chapterId: 3,
      childCount: 0,
      depth: 0,
      fragmentCount: 0,
      stage: "planned",
      title: "Planned chapter",
      tocPath: ["Planned chapter"],
      words: 0,
    },
  ],
  sourceFindHits: [
    {
      chapter: 2,
      field: "source",
      id: "wikg://chapter/2/source#1..2",
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
        id: "wikg://chapter/2/source#1..2",
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
        id: "wikg://chapter/2/source#4",
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
            id: "wikg://chapter/2/source#1..2",
            source: "RAG original source fragment.",
            startSentenceIndex: 0,
            title: "Chapter 2",
            type: "source",
          },
        ],
        total: 1,
      },
      id: "wikg://triple/Q1/mentions/Q2",
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
        id: "wikg://entity/Q1",
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
    id: "wikg://chapter/2/state",
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
          id: "wikg://chapter/2/source#1..2",
          source: "RAG original source fragment.",
          startSentenceIndex: 0,
          title: "Chapter 2",
          type: "source",
        },
      ],
      total: 1,
    },
    id: "wikg://entity/Q1",
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
    id: "wikg://entity/Q1/wikipage",
    type: "entity-wikipage",
    zh: {
      description: "明朝军事将领",
      title: "徐达",
      url: "https://zh.wikipedia.org/wiki/%E5%BE%90%E8%BE%BE",
    },
  } satisfies ArchivePage,
  sourceRangePage: {
    fragment: {
      id: "wikg://chapter/2/source#1..2",
      preview: "RAG original source fragment.",
      sentenceCount: 2,
      text: "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
      wordsCount: 5,
    },
    id: "wikg://chapter/2/source#1..2",
    nextFragmentId: undefined,
    nodes: [],
    previousFragmentId: undefined,
    title: "wikg://chapter/2/source#1..2",
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
          id: "wikg://chapter/2/source#1..2",
          source:
            "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
          startSentenceIndex: 0,
          title: "Chapter 2",
          type: "source",
        },
        {
          chapterId: 2,
          endSentenceIndex: 3,
          id: "wikg://chapter/2/source#4",
          source: "Follow-up source fragment.",
          startSentenceIndex: 3,
          title: "Chapter 2",
          type: "source",
        },
      ],
      total: 2,
    },
    id: "wikg://triple/Q1/mentions/Q2",
    label: "RAG(Q1) mentions agent(Q2)",
    objectQid: "Q2",
    predicate: "mentions",
    subjectQid: "Q1",
    type: "triple",
  } satisfies ArchivePage,
  readCalls: [] as string[],
  serials: new Map([
    [1, { knowledgeGraphReady: true, topologyReady: true }],
    [2, { knowledgeGraphReady: false, topologyReady: false }],
    [3, { knowledgeGraphReady: false, topologyReady: false }],
  ]),
  summaryWords: 120,
  textWrites: [] as string[],
  convertCalls: [] as unknown[],
  writeCalls: [] as string[],
}));

export { archiveMockState };

export function parseJSONLLastLine(text: string | undefined): unknown {
  const line = text?.trim().split("\n").at(-1);

  if (line === undefined) {
    return undefined;
  }

  return JSON.parse(line) as unknown;
}

vi.mock(
  "../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js",
  () => ({
    WikiGraphArchiveFile: class {
      readonly #path: string;

      public constructor(path: string) {
        this.#path = path;
      }

      public async readDocument(
        operation: (document: unknown) => Promise<unknown>,
      ): Promise<unknown> {
        archiveMockState.readCalls.push(this.#path);
        return await operation(createArchiveMockDocument());
      }

      public async write(operation: () => Promise<unknown>): Promise<unknown> {
        archiveMockState.writeCalls.push(this.#path);
        return await operation();
      }
    },
  }),
);

vi.mock("../../../packages/core/src/api/index.js", () => ({
  createContinuationCursor: vi.fn(() => Promise.resolve("c_next")),
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
  listChapters: vi.fn(() => Promise.resolve(archiveMockState.inspectChapters)),
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
      id === "wikg://entity/Q1"
        ? archiveMockState.entityPage
        : id === "wikg://entity/Q1/wikipage"
          ? archiveMockState.entityWikipagePage
          : id === "wikg://triple/Q1/mentions/Q2"
            ? archiveMockState.triplePage
            : id === "wikg://chapter/2"
              ? archiveMockState.chapterPage
              : id === "wikg://chapter/2/source#1..2"
                ? archiveMockState.sourceRangePage
                : id === "wikg://"
                  ? archiveMockState.metaPage
                  : id === "wikg://chapter/2/state"
                    ? archiveMockState.statePage
                    : archiveMockState.page,
    ),
  ),
}));

vi.mock("../../../packages/core/src/retrieval/search-index/index.js", () => ({
  readArchiveIndexSettings: vi.fn(() =>
    Promise.resolve({ ftsEmbedded: archiveMockState.ftsEmbedded }),
  ),
}));

vi.mock("../../../packages/core/src/retrieval/query/index.js", () => ({
  isArchiveSearchIndexCurrent: vi.fn(() =>
    Promise.resolve(archiveMockState.ftsCurrent),
  ),
}));

vi.mock("../../../packages/cli/src/runtime/config.js", () => ({
  loadCLIConfig: vi.fn(() =>
    Promise.resolve({
      concurrent: {
        job: 2,
        request: 3,
      },
      llm: {
        model: "gpt-test",
        provider: "openai-compatible",
      },
    }),
  ),
}));

vi.mock(
  "../../../packages/cli/src/support/index.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof CLISupport>();

    return {
      ...actual,
      writeTextToStdout: vi.fn((text: string) => {
        archiveMockState.textWrites.push(text);
        return Promise.resolve();
      }),
    };
  },
);

vi.mock("../../../packages/cli/src/commands/convert.js", () => ({
  runConvertCommand: vi.fn(async (args: { readonly outputPath?: string }) => {
    archiveMockState.convertCalls.push(args);
    if (args.outputPath !== undefined) {
      const { writeFile: writeOutputFile } = await import("fs/promises");

      await writeOutputFile(args.outputPath, "created");
    }
  }),
}));

function createArchiveMockDocument(): unknown {
  const document = {};

  Object.defineProperties(document, {
    readDatabase: {
      value: async (
        operation: (database: {
          readonly queryOne: (
            sql: string,
            params: unknown,
            map: (row: { readonly words: number }) => unknown,
          ) => Promise<unknown>;
        }) => Promise<unknown>,
      ) =>
        await operation({
          queryOne: (_sql, _params, map) =>
            Promise.resolve(map({ words: archiveMockState.summaryWords })),
        }),
    },
    serials: {
      value: {
        getById: (chapterId: number) =>
          Promise.resolve(archiveMockState.serials.get(chapterId)),
      },
    },
  });

  return document;
}

function createDefaultInspectChapters(): typeof archiveMockState.inspectChapters {
  return [
    {
      chapterId: 1,
      childCount: 0,
      depth: 0,
      fragmentCount: 1,
      stage: "summarized",
      title: "Ready chapter",
      tocPath: ["Ready chapter"],
      words: 800,
    },
    {
      chapterId: 2,
      childCount: 0,
      depth: 0,
      fragmentCount: 1,
      stage: "sourced",
      title: "Missing chapter",
      tocPath: ["Missing chapter"],
      words: 400,
    },
    {
      chapterId: 3,
      childCount: 0,
      depth: 0,
      fragmentCount: 0,
      stage: "planned",
      title: "Planned chapter",
      tocPath: ["Planned chapter"],
      words: 0,
    },
  ];
}

function createDefaultInspectSerials(): typeof archiveMockState.serials {
  return new Map([
    [1, { knowledgeGraphReady: true, topologyReady: true }],
    [2, { knowledgeGraphReady: false, topologyReady: false }],
    [3, { knowledgeGraphReady: false, topologyReady: false }],
  ]);
}

export function resetArchiveMockState(): void {
  vi.clearAllMocks();
  archiveMockState.ftsCurrent = false;
  archiveMockState.ftsEmbedded = false;
  archiveMockState.inspectChapters = createDefaultInspectChapters();
  archiveMockState.readCalls.length = 0;
  archiveMockState.serials = createDefaultInspectSerials();
  archiveMockState.summaryWords = 120;
  archiveMockState.convertCalls.length = 0;
  archiveMockState.textWrites.length = 0;
  archiveMockState.writeCalls.length = 0;
}
