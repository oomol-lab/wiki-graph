import { beforeEach, describe, expect, it, vi } from "vitest";

const archiveMockState = vi.hoisted(() => ({
  editableCalls: [] as string[],
  evidence: [
    {
      sentenceId: [2, 0, 1],
      text: "RAG evidence sentence.",
    },
  ],
  findHits: [
    {
      chapter: 2,
      field: "content",
      id: "node:9",
      matchCount: 1,
      matchedTerms: ["rag"],
      missingTerms: [],
      position: { chapter: 2, fragment: 0, sentence: 1 },
      score: 1,
      snippet: "RAG appears in this node.",
      title: "Retrieval design",
      type: "node",
    },
  ],
  grepHits: [
    {
      chapter: 2,
      field: "source",
      id: "fragment:2:0",
      position: { chapter: 2, fragment: 0 },
      snippet: "Exact phrase appears here.",
      title: "Chapter 2",
      type: "fragment",
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
  links: [
    {
      direction: "outgoing",
      edge: {
        fromId: 9,
        toId: 11,
        weight: 0.5,
      },
      node: {
        content: "Related node",
        id: 11,
        label: "Related",
        sentenceIds: [[2, 0, 2]],
        weight: 0.4,
        wordsCount: 2,
      },
    },
  ],
  listItems: [
    {
      id: "node:9",
      label: "Retrieval design",
      summary: "RAG appears in this node.",
      type: "node",
    },
  ],
  collection: {
    chapters: [2],
    ids: null,
    items: [
      {
        chapter: 2,
        field: "content",
        id: "node:9",
        matchCount: 1,
        matchedTerms: ["rag"],
        missingTerms: [],
        position: { chapter: 2, fragment: 0, sentence: 1 },
        score: 1,
        snippet: "RAG appears in this node.",
        title: "Retrieval design",
        type: "node",
      },
    ],
    limit: 20,
    nextCursor: null,
    order: "doc-asc",
    types: ["node"],
  },
  page: {
    evidence: [
      {
        sentenceId: [2, 0, 1],
        text: "RAG evidence sentence.",
      },
    ],
    id: "node:9",
    incoming: [],
    neighbors: [],
    node: {
      content: "RAG appears in this node.",
      id: 9,
      label: "Retrieval design",
      sentenceIds: [[2, 0, 1]],
      weight: 0.7,
      wordsCount: 5,
    },
    outgoing: [],
    position: { chapter: 2, fragment: 0, sentence: 1 },
    title: "Retrieval design",
    type: "node",
  },
  chapterPage: {
    chapter: {
      chapterId: 2,
      childCount: 0,
      depth: 0,
      fragmentCount: 1,
      stage: "summarized",
      title: "Chapter 2",
      tocPath: ["Chapter 2"],
    },
    content: `Long summary ${"summary ".repeat(220)}`,
    fragments: [],
    id: "chapter:2",
    nodeCount: 2,
    nodeGroups: [
      {
        groupId: 0,
        id: "node-group:2:0",
        nodeCount: 2,
        nodes: [
          {
            id: "node:9",
            position: { chapter: 2, fragment: 0, sentence: 1 },
            title: "Retrieval design",
          },
          {
            id: "node:11",
            position: { chapter: 2, fragment: 0, sentence: 2 },
            title: "Related",
          },
        ],
        span: {
          end: { chapter: 2, fragment: 0, sentence: 2 },
          start: { chapter: 2, fragment: 0, sentence: 1 },
        },
        weight: 1,
        wordsCount: 7,
      },
    ],
    sourcePreview: "Chapter source preview.",
    title: "Chapter 2",
    type: "chapter",
  },
  readText: "Readable archive text.",
  textWrites: [] as string[],
}));

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async openEditableSession(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      archiveMockState.editableCalls.push(this.#path);
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
      targetStage: "ready",
    }),
  ),
  findArchiveObjects: vi.fn(
    (
      _document: unknown,
      query: string,
      options: { readonly match?: "all" | "any" },
    ) =>
      Promise.resolve({
        chapters: null,
        items: archiveMockState.findHits,
        limit: 20,
        match: options.match ?? "any",
        nextCursor: null,
        order: "doc-asc",
        query,
        terms: query
          .trim()
          .toLowerCase()
          .split(/\s+/u)
          .filter((term) => term !== ""),
        types: null,
      }),
  ),
  findGraphPath: vi.fn(() => Promise.resolve([])),
  formatNodeId: (id: number) => `node:${id}`,
  getArchiveIndex: vi.fn(() => Promise.resolve(archiveMockState.index)),
  grepArchiveObjects: vi.fn(() =>
    Promise.resolve({
      chapters: null,
      items: archiveMockState.grepHits,
      limit: 20,
      match: "any",
      nextCursor: null,
      order: "doc-asc",
      query: "exact phrase",
      terms: ["exact", "phrase"],
      types: null,
    }),
  ),
  listArchiveCollection: vi.fn(() =>
    Promise.resolve(archiveMockState.collection),
  ),
  listArchiveLinks: vi.fn(() => Promise.resolve(archiveMockState.links)),
  listArchiveObjects: vi.fn(() => Promise.resolve(archiveMockState.listItems)),
  listRelatedArchiveObjects: vi.fn(() =>
    Promise.resolve(archiveMockState.listItems),
  ),
  packArchiveContext: vi.fn(() =>
    Promise.resolve({
      anchor: archiveMockState.page,
      budget: 1000,
      evidence: archiveMockState.evidence,
      links: archiveMockState.links,
    }),
  ),
  readArchiveEvidence: vi.fn(() => Promise.resolve(archiveMockState.evidence)),
  readArchivePage: vi.fn((_document: unknown, id: string) =>
    Promise.resolve(
      id === "chapter:2" ? archiveMockState.chapterPage : archiveMockState.page,
    ),
  ),
  readArchiveText: vi.fn(() => Promise.resolve(archiveMockState.readText)),
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
  grepArchiveObjects,
  listArchiveCollection,
  readArchiveText,
} from "../../src/facade/index.js";

describe("cli/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archiveMockState.editableCalls.length = 0;
    archiveMockState.textWrites.length = 0;
    archiveMockState.links.splice(0, archiveMockState.links.length, {
      direction: "outgoing",
      edge: {
        fromId: 9,
        toId: 11,
        weight: 0.5,
      },
      node: {
        content: "Related node",
        id: 11,
        label: "Related",
        sentenceIds: [[2, 0, 2]],
        weight: 0.4,
        wordsCount: 2,
      },
    });
  });

  it("prints an archive index", async () => {
    await runArchiveCommand({
      action: "index",
      archivePath: "/tmp/book.sdpub",
    });

    expect(archiveMockState.editableCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(archiveMockState.textWrites[0]).toContain("Archive Type: LLM Wiki");
    expect(archiveMockState.textWrites[0]).toContain("chapter:2");
  });

  it("prints search hits with next commands", async () => {
    await runArchiveCommand({
      action: "find",
      archivePath: "/tmp/book.sdpub",
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain("node:9  node/content");
    expect(archiveMockState.textWrites[0]).toContain("Matched: rag");
    expect(archiveMockState.textWrites[0]).toContain(
      "Next: spinedigest page <archive.sdpub> node:9",
    );
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      chapters: undefined,
      cursor: undefined,
      limit: undefined,
      match: undefined,
      order: undefined,
      types: undefined,
    });
    expect(grepArchiveObjects).not.toHaveBeenCalled();
  });

  it("prints archive collection items", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "/tmp/book.sdpub",
      chapters: [2],
      searchTypes: ["node"],
    });

    expect(archiveMockState.textWrites[0]).toContain("node:9  node/content");
    expect(listArchiveCollection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        chapters: [2],
        types: ["node"],
      }),
    );
  });

  it("prints continuous read text", async () => {
    await runArchiveCommand({
      action: "read",
      archivePath: "/tmp/book.sdpub",
      objectId: "chapter:2",
    });

    expect(archiveMockState.textWrites[0]).toBe("Readable archive text.\n");
    expect(readArchiveText).toHaveBeenCalledWith({}, "chapter:2");
  });

  it("routes grep through exact text search", async () => {
    await runArchiveCommand({
      action: "grep",
      archivePath: "/tmp/book.sdpub",
      query: "exact phrase",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "fragment:2:0  fragment/source",
    );
    expect(grepArchiveObjects).toHaveBeenCalledWith({}, "exact phrase", {
      chapters: undefined,
      cursor: undefined,
      limit: undefined,
      match: undefined,
      order: undefined,
      types: undefined,
    });
    expect(findArchiveObjects).not.toHaveBeenCalled();
  });

  it("explains empty all-keyword find results", async () => {
    archiveMockState.findHits.splice(0, archiveMockState.findHits.length);

    await runArchiveCommand({
      action: "find",
      archivePath: "/tmp/book.sdpub",
      match: "all",
      query: "one two",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "All 2 terms were required",
    );
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "one two", {
      chapters: undefined,
      cursor: undefined,
      limit: undefined,
      match: "all",
      order: undefined,
      types: undefined,
    });
  });

  it("passes search controls to find", async () => {
    await runArchiveCommand({
      action: "find",
      archivePath: "/tmp/book.sdpub",
      chapters: [11, 12],
      cursor: "cursor-token",
      limit: 10,
      query: "RAG",
      searchOrder: "doc-desc",
      searchTypes: ["summary", "node"],
    });

    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      chapters: [11, 12],
      cursor: "cursor-token",
      limit: 10,
      match: undefined,
      order: "doc-desc",
      types: ["summary", "node"],
    });
  });

  it("prints page content and evidence", async () => {
    await runArchiveCommand({
      action: "page",
      archivePath: "/tmp/book.sdpub",
      objectId: "node:9",
    });

    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("RAG appears");
    expect(archiveMockState.textWrites[0]).toContain("sentence:2:0:1");
  });

  it("prints chapter node groups before truncated summary", async () => {
    await runArchiveCommand({
      action: "page",
      archivePath: "/tmp/book.sdpub",
      objectId: "chapter:2",
    });

    const output = archiveMockState.textWrites[0] ?? "";

    expect(output.indexOf("Node Groups:")).toBeLessThan(
      output.indexOf("Summary:"),
    );
    expect(output).toContain("node:9  Retrieval design");
    expect(output).toContain("Source Preview:");
    expect(output.length).toBeLessThan(1800);
  });

  it("prints JSON evidence", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "/tmp/book.sdpub",
      json: true,
      objectId: "node:9",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      evidence: archiveMockState.evidence,
    });
  });

  it("prints related nodes", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "/tmp/book.sdpub",
      objectId: "node:9",
    });

    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("Retrieval design");
  });

  it("points links users to backlinks when outgoing links are empty", async () => {
    archiveMockState.links.length = 0;

    await runArchiveCommand({
      action: "links",
      archivePath: "/tmp/book.sdpub",
      objectId: "node:9",
    });

    expect(archiveMockState.textWrites[0]).toContain("No outgoing links");
    expect(archiveMockState.textWrites[0]).toContain(
      "spinedigest backlinks <archive.sdpub> <node:id>",
    );
  });

  it("prints a context pack", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "/tmp/book.sdpub",
      budget: 1000,
      objectId: "node:9",
    });

    expect(archiveMockState.textWrites[0]).toContain("Pack Budget: 1000");
    expect(archiveMockState.textWrites[0]).toContain("# Anchor");
    expect(archiveMockState.textWrites[0]).toContain("# Evidence");
  });
});
