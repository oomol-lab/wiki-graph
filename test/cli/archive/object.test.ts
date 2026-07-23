import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveMockState, resetArchiveMockState } from "./mock.js";
import { runArchiveCommand } from "../../../packages/cli/src/commands/index.js";
import { formatFindObject } from "../../../packages/cli/src/commands/archive-output/text/object.js";
import {
  createContinuationCursor,
  readArchivePage,
} from "../../../packages/core/src/api/index.js";

beforeEach(resetArchiveMockState);

describe("cli/archive/object", () => {
  it("gets an object by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chunk/9",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikg://chunk/9", {});
    expect(archiveMockState.textWrites[0]).toContain("node:9");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
  });

  it("gets a chapter as a minimal object", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chapter/2",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikg://chapter/2", {});
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wikg://chapter/2",
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
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chapter/2",
    });

    expect(archiveMockState.textWrites[0]).toBe(
      "wikg://chapter/2  Chapter 2  source:ready reading-graph:ready reading-summary:missing knowledge-graph:missing\n",
    );
  });

  it("falls back to single archive provenance when sources is empty", () => {
    expect(
      formatFindObject({
        archiveId: 7,
        label: "Entity",
        libraryArchiveUri: "wikg://lib/archive-7",
        sources: [],
        type: "entity",
        uri: "wikg://entity/Q7",
      }),
    ).toBe("wikg://entity/Q7\nEntity\narchiveId:7  wikg://lib/archive-7");
  });

  it("gets a source range as a citation block", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chapter/2/source#1..2",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://chapter/2/source#1..2",
      {},
    );
    expect(archiveMockState.textWrites[0]).toBe(
      [
        "@@ wikg://chapter/2/source#1..2 @@",
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
      archivePath: "wikg:///tmp/book.wikg",
      backlinks: true,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chapter/2/source#1..2",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://chapter/2/source#1..2",
      { backlinks: true },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      backlinks: {
        chunks: {
          nextCursor: null,
          objects: [{ uri: "wikg://chunk/9" }],
        },
        entities: {
          nextCursor: null,
          objects: [{ uri: "wikg://entity/Q1" }],
        },
        triples: {
          nextCursor: null,
          objects: [{ uri: "wikg://triple/Q1/mentions/Q2" }],
        },
      },
      uri: "wikg://chapter/2/source#1..2",
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
      archivePath: "wikg:///tmp/book.wikg",
      backlinks: true,
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chapter/2/source#1..2",
    });

    expect(archiveMockState.textWrites[0]).toContain("Backlinks:");
    expect(archiveMockState.textWrites[0]).toContain("wikg://chunk/9");
    expect(archiveMockState.textWrites[0]).toContain("wikg://entity/Q1");
    expect(archiveMockState.textWrites[0]).toContain(
      "wikg://triple/Q1/mentions/Q2",
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

  it("gets the archive root object URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/",
    });

    expect(readArchivePage).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toBe("<archive>\n");
  });

  it("prints the archive root object URI as json", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/",
    });

    expect(readArchivePage).not.toHaveBeenCalled();
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wikg:///tmp/book.wikg",
    });
  });

  it("inspects archive readiness as a text report", async () => {
    await runArchiveCommand({
      action: "inspect",
      archivePath: "/tmp/book.wikg",
    });

    expect(archiveMockState.readCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(archiveMockState.textWrites[0]).toContain("Archive Inspect");
    expect(archiveMockState.textWrites[0]).toContain(
      "Chapters: 2 content / 3 total",
    );
    expect(archiveMockState.textWrites[0]).toContain("Source words: 1200");
    expect(archiveMockState.textWrites[0]).toContain("Summary words: 120");
    expect(archiveMockState.textWrites[0]).toContain(
      "Status: missing or outdated",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Reading Graph: 1/2 chapters, 800/1200 words, 66.7%",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Knowledge Graph: 1/2 chapters, 800/1200 words, 66.7%",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Summary: 1/2 chapters, 800/1200 words, 66.7%",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Command: wg wikg:///tmp/book.wikg/index enable",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Command: wg wikg://local/job add --input wikg:///tmp/book.wikg --task reading-graph --accept-cost",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "If completing this scope:",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Model: openai-compatible/gpt-test",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Tokens: 10000 input / 8000 cacheable input / 1600 output",
    );
    expect(archiveMockState.textWrites[0]).toContain("Wait:");
    expect(archiveMockState.textWrites[0]).toContain("Performance hints:");
    expect(archiveMockState.textWrites[0]).toContain(
      "Current request: 3; suggested: 6.",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Command: wg wikg://local/config/concurrent put request 6",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Readiness details: wg help readiness",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Calls:");
    expect(archiveMockState.textWrites[0]).not.toContain("Cost: $");
  });

  it("inspects a resolved located archive URI via its filesystem path", async () => {
    await runArchiveCommand({
      action: "inspect",
      archivePath: "wikg:///tmp/library/book.wikg",
    });

    expect(archiveMockState.readCalls).toStrictEqual([
      "/tmp/library/book.wikg",
    ]);
    expect(archiveMockState.textWrites[0]).toContain("Archive Inspect");
  });

  it("prints request and job performance hints for multi-chapter generation", async () => {
    archiveMockState.inspectChapters = [
      {
        chapterId: 1,
        childCount: 0,
        depth: 0,
        fragmentCount: 1,
        path: "1",
        stage: "sourced",
        title: "First chapter",
        tocPath: ["First chapter"],
        words: 500,
      },
      {
        chapterId: 2,
        childCount: 0,
        depth: 0,
        fragmentCount: 1,
        path: "2",
        stage: "sourced",
        title: "Second chapter",
        tocPath: ["Second chapter"],
        words: 600,
      },
      {
        chapterId: 3,
        childCount: 0,
        depth: 0,
        fragmentCount: 1,
        path: "3",
        stage: "sourced",
        title: "Third chapter",
        tocPath: ["Third chapter"],
        words: 700,
      },
    ];
    archiveMockState.serials = new Map([
      [1, { knowledgeGraphReady: false, topologyReady: false }],
      [2, { knowledgeGraphReady: false, topologyReady: false }],
      [3, { knowledgeGraphReady: false, topologyReady: false }],
    ]);

    await runArchiveCommand({
      action: "inspect",
      archivePath: "/tmp/book.wikg",
    });

    const output = archiveMockState.textWrites[0] ?? "";
    const requestIndex = output.indexOf(
      "Command: wg wikg://local/config/concurrent put request 6",
    );
    const jobIndex = output.indexOf(
      "Command: wg wikg://local/config/concurrent put job 4",
    );

    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(jobIndex).toBeGreaterThanOrEqual(0);
    expect(requestIndex).toBeLessThan(jobIndex);
  });

  it("quotes generated inspect commands for shell copy and paste", async () => {
    await runArchiveCommand({
      action: "inspect",
      archivePath: "/tmp/My Book.wikg",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "Command: wg 'wikg:///tmp/My Book.wikg/index' enable",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Command: wg wikg://local/job add --input 'wikg:///tmp/My Book.wikg' --task reading-graph --accept-cost",
    );
  });

  it("inspects archive readiness as a json report", async () => {
    interface InspectJSONReport {
      readonly improvements: readonly unknown[];
      readonly performanceHints: readonly unknown[];
      readonly retrievalGuidance: readonly string[];
    }

    await runArchiveCommand({
      action: "inspect",
      archivePath: "/tmp/book.wikg",
      json: true,
    });

    const output = JSON.parse(
      archiveMockState.textWrites[0] ?? "",
    ) as unknown as InspectJSONReport;

    expect(output).toMatchObject({
      uri: "wikg:///tmp/book.wikg",
      scope: { type: "archive" },
      content: {
        chapters: {
          content: 2,
          planned: 1,
          total: 3,
        },
        sourceWords: 1200,
        summaryWords: 120,
      },
      index: {
        current: false,
        fixCommand: "wg wikg:///tmp/book.wikg/index enable",
        querySupport: false,
        status: "missing-or-outdated",
        storage: "cache",
      },
      coverage: {
        knowledgeGraph: {
          coveredChapters: 1,
          coveredWords: 800,
          percent: "66.7%",
          totalChapters: 2,
          totalWords: 1200,
        },
        readingGraph: {
          coveredChapters: 1,
          coveredWords: 800,
          percent: "66.7%",
          totalChapters: 2,
          totalWords: 1200,
        },
        summary: {
          coveredChapters: 1,
          coveredWords: 800,
          percent: "66.7%",
          totalChapters: 2,
          totalWords: 1200,
        },
      },
      help: { readiness: "wg help readiness" },
    });
    expect(output.retrievalGuidance).toEqual(
      expect.arrayContaining([
        "Query support: unavailable until the searchable index is enabled.",
      ]),
    );
    expect(output.improvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "wg wikg:///tmp/book.wikg/index enable",
          recommendation:
            "Enable the searchable FTS index so --query filtering is available for scopes, related results, and evidence.",
          title: "Enable searchable index",
        }),
        expect.objectContaining({
          command:
            "wg wikg://local/job add --input wikg:///tmp/book.wikg --task reading-graph --accept-cost",
          missingChapters: 1,
          missingWords: 400,
          planning: {
            model: "openai-compatible/gpt-test",
            timeSeconds: {
              max: 139,
              min: 49,
            },
            tokens: {
              cacheableInput: 8000,
              input: 10000,
              output: 1600,
            },
          },
          title: "Complete Reading Graph coverage",
        }),
      ]),
    );
    expect(output.performanceHints).toEqual([
      {
        command: "wg wikg://local/config/concurrent put request 6",
        current: 3,
        kind: "request",
        message:
          "LLM request concurrency can often be higher. Use at least 4; 6-8 is usually faster when the provider allows it.",
        recommended: 6,
      },
    ]);
  });

  it("inspects empty archive content without showing zero-percent coverage", async () => {
    archiveMockState.inspectChapters = [];
    archiveMockState.summaryWords = 0;

    await runArchiveCommand({
      action: "inspect",
      archivePath: "/tmp/empty.wikg",
    });

    expect(archiveMockState.textWrites[0]).toContain("Source content: empty.");
    expect(archiveMockState.textWrites[0]).toContain(
      "Reading Graph: n/a, no source content",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Knowledge Graph: n/a, no source content",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "Summary: n/a, no source content",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("0%");
  });

  it("gets an entity by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikg://entity/Q1", {
      evidenceLimit: 3,
    });
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      uri: "wikg://entity/Q1",
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
            uri: "wikg://chapter/2/source#1..2",
            text: "RAG original source fragment.",
          },
        ],
        total: 1,
      },
    });
    expect(archiveMockState.textWrites[0]).toContain(
      ['  "uri": "wikg://entity/Q1",', '  "labels": [', '    "RAG",'].join(
        "\n",
      ),
    );
  });

  it("gets an entity wikipage by Wiki Graph URI", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1/wikipage",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://entity/Q1/wikipage",
      {},
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      en: {
        description: "Ming dynasty general",
        title: "Xu Da",
        url: "https://en.wikipedia.org/wiki/Xu_Da",
      },
      uri: "wikg://entity/Q1/wikipage",
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
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/entity/Q1/wikipage",
    });

    expect(archiveMockState.textWrites[0]).toBe(
      [
        "wikg://entity/Q1/wikipage",
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
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 0,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikg://entity/Q1", {});
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
      uri: "wikg://entity/Q1",
    });
  });

  it("hides text get evidence with evidence zero", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 0,
      format: "text",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith({}, "wikg://entity/Q1", {});
    expect(archiveMockState.textWrites[0]).toBe(
      [
        "wikg://entity/Q1",
        "RAG",
        "",
        "Next:",
        "  wg wikg:///tmp/book.wikg/entity/Q1 evidence",
        "  wg wikg:///tmp/book.wikg/entity/Q1 related",
        "  wg wikg:///tmp/book.wikg/entity/Q1/wikipage",
        "",
      ].join("\n"),
    );
  });

  it("defaults evidence for chapter-scoped entity pages", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chapter/2/entity/Q1",
    });

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://chapter/2/entity/Q1",
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
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 1,
      format: "text",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      "2 more evidence: wg next c_more_evidence",
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Mentions:");
    expect(archiveMockState.textWrites[0]).not.toContain("Next page:");
  });

  it("prints entity investigation next steps in text get output", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      [
        "Next:",
        "  wg wikg:///tmp/book.wikg/entity/Q1 evidence",
        "  wg wikg:///tmp/book.wikg/entity/Q1 related",
        "  wg wikg:///tmp/book.wikg/entity/Q1/wikipage",
      ].join("\n"),
    );
  });

  it("gets a triple as concise JSON", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    const output = JSON.parse(archiveMockState.textWrites[0] ?? "") as Record<
      string,
      unknown
    >;

    expect(readArchivePage).toHaveBeenCalledWith(
      {},
      "wikg://triple/Q1/mentions/Q2",
      { evidenceLimit: 3 },
    );
    expect(output).toStrictEqual({
      evidence: {
        nextCursor: null,
        shown: 2,
        sources: [
          {
            text: "\n\t\nRAG original source fragment.\n   \n\t\nSecond paragraph.\n\n",
            uri: "wikg://chapter/2/source#1..2",
          },
          {
            text: "Follow-up source fragment.",
            uri: "wikg://chapter/2/source#4",
          },
        ],
        total: 2,
      },
      label: "RAG(Q1) mentions agent(Q2)",
      uri: "wikg://triple/Q1/mentions/Q2",
    });
    expect(output).not.toHaveProperty("id");
    expect(output).not.toHaveProperty("subjectQid");
    expect(output).not.toHaveProperty("predicate");
    expect(output).not.toHaveProperty("objectQid");
  });
});
