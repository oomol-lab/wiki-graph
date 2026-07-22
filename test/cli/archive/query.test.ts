import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveMockState,
  parseJSONLLastLine,
  resetArchiveMockState,
} from "./mock.js";
import { runArchiveCommand } from "../../../packages/cli/src/commands/index.js";
import {
  createContinuationCursor,
  findArchiveObjects,
  listArchiveCollection,
  readContinuationCursor,
  readArchivePage,
} from "../../../packages/core/src/api/index.js";

beforeEach(resetArchiveMockState);

describe("cli/archive/query", () => {
  it("gets chapter state", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg/chapter/2/state",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chapter/2/state",
    });

    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://chapter/2/state",
      {},
    );
  });

  it("prints search hits as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      kinds: ["chunk"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain("wikg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("Retrieval design");
    expect(findArchiveObjects).toHaveBeenCalledWith({}, "RAG", {
      archiveKey: "/tmp/book.wikg",
      types: ["node"],
    });
  });

  it("prints source search hits as citation blocks", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikg:///tmp/book.wikg",
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
        "@@ wikg://chapter/2/source#1..2 @@",
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
      archivePath: "wikg:///tmp/book.wikg",
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
    expect(archiveMockState.textWrites[0]).toContain("wikg://entity/Q1");
    expect(archiveMockState.textWrites[0]).not.toContain("1 wikg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("-- evidence 1/1");
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wikg://chapter/2/source#1..2 @@",
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
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 1,
      format: "text",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "2 more evidence: wg next c_more_evidence",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Next page: wg next c_more_results",
    );
  });

  it("prints listed archive objects as Wiki Graph URI objects", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
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
    expect(archiveMockState.textWrites[0]).toContain("wikg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain("RAG");
    expect(archiveMockState.textWrites[0]).toContain(
      "Open short URIs with the archive locator",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "wg wikg:///tmp/book.wikg/entity/Q1",
    );
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
      archivePath: "wikg:///tmp/book.wikg/source",
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
            chunks: { objects: [{ uri: "wikg://chunk/9" }] },
            entities: { objects: [{ uri: "wikg://entity/Q1" }] },
            triples: { objects: [{ uri: "wikg://triple/Q1/mentions/Q2" }] },
          },
          uri: "wikg://chapter/2/source#1..2",
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
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
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
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
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
      archivePath: "wikg:///tmp/book.wikg/source",
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
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
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
            id: "chapter-title:1",
            position: { chapter: 1 },
            snippet: "Chapter 1",
            title: "Chapter 1",
            type: "chapter-title",
          },
        ],
        nextCursor: "raw-collection-cursor",
      })
      .mockResolvedValueOnce({
        ...archiveMockState.collection,
        items: [
          {
            field: "title",
            id: "chapter-title:2",
            position: { chapter: 2 },
            snippet: "Chapter 2",
            title: "Chapter 2",
            type: "chapter-title",
          },
        ],
        nextCursor: null,
      });

    await runArchiveCommand({
      action: "list",
      all: true,
      archivePath: "wikg:///tmp/book.wikg/chapter",
      format: "jsonl",
      kinds: ["chapter"],
      limit: 1,
    });

    expect(listArchiveCollection).toHaveBeenNthCalledWith(
      1,
      {},
      {
        limit: 1,
        types: ["chapter-title"],
      },
    );
    expect(listArchiveCollection).toHaveBeenNthCalledWith(
      2,
      {},
      {
        cursor: "raw-collection-cursor",
        limit: 1,
        types: ["chapter-title"],
      },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wikg://chapter/1/title"',
    );
    expect(archiveMockState.textWrites[1]).toContain(
      '"uri":"wikg://chapter/2/title"',
    );
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
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
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
          uri: "wikg://entity/Q1",
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
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
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
                uri: "wikg://chapter/2/source#1..2",
              },
            ],
            total: 3,
          },
          label: "RAG",
          type: "entity",
          uri: "wikg://entity/Q1",
        },
      ],
    });
  });

  it("keeps listed object evidence disabled with evidence zero", async () => {
    await runArchiveCommand({
      action: "list",
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
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
          uri: "wikg://entity/Q1",
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
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
      evidenceLimit: 1,
      format: "json",
      kinds: ["entity"],
    });

    expect(createContinuationCursor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: "raw-evidence-cursor",
        kind: "evidence",
        targetUri: "wikg://entity/Q1",
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
      archivePath: "wikg:///tmp/book.wikg/chapter/2",
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
                uri: "wikg://chapter/2/source#1..2",
              },
            ],
            total: 1,
          },
          objectLabel: "agent",
          predicate: "mentions",
          subjectLabel: "RAG",
          uri: "wikg://triple/Q1/mentions/Q2",
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
      archivePath: "wikg:///tmp/book.wikg",
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
          uri: "wikg://entity/Q1",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).toContain(
      [
        '      "uri": "wikg://entity/Q1"',
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
      archivePath: "wikg:///tmp/book.wikg",
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
                uri: "wikg://chapter/2/source#1..2",
              },
            ],
            total: 1,
          },
          objectLabel: "agent",
          predicate: "mentions",
          subjectLabel: "RAG",
          uri: "wikg://triple/Q1/mentions/Q2",
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
      archivePath: "wikg:///tmp/book.wikg/source",
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
            chunks: { objects: [{ uri: "wikg://chunk/9" }] },
            entities: { objects: [{ uri: "wikg://entity/Q1" }] },
            triples: { objects: [{ uri: "wikg://triple/Q1/mentions/Q2" }] },
          },
          uri: "wikg://chapter/2/source#1..2",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).not.toContain('"type": "source"');
  });

  it("prints search cursor metadata as JSONL", async () => {
    await runArchiveCommand({
      action: "search",
      archivePath: "wikg:///tmp/book.wikg",
      format: "jsonl",
      kinds: ["entity"],
      query: "RAG",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wikg://entity/Q1"',
    );
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
          uri: "wikg://entity/Q1",
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
      archivePath: "wikg:///tmp/book.wikg",
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
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "search",
      query: "RAG",
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
      archivePath: "wikg:///tmp/book.wikg",
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
      indexScope: {
        archiveKey: "/tmp/book.wikg",
        archivePath: "/tmp/book.wikg",
        kind: "archive-index",
      },
      kind: "evidence",
      order: "doc-asc",
      query: "RAG",
      targetUri: "wikg://entity/Q1",
    });
  });
});
