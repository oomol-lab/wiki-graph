import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveMockState,
  parseJSONLLastLine,
  resetArchiveMockState,
} from "./mock.js";
import { runArchiveCommand } from "../../../packages/cli/src/commands/index.js";
import {
  createContinuationCursor,
  listArchiveEvidence,
} from "../../../packages/core/src/api/index.js";

beforeEach(resetArchiveMockState);

describe("cli/archive/evidence pack", () => {
  it("prints evidence source ranges", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith(
      {},
      "wikg://triple/Q1/mentions/Q2",
      {},
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "wikg://chapter/2/source#1..2",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "@@ wikg://chapter/2/source#1..2 @@",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "RAG original source fragment.",
    );
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "@@ wikg://chapter/2/source#1..2 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "@@ wikg://chapter/2/source#4 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).toContain(
      "score: 2.5\n@@ wikg://chapter/2/source#1..2 @@",
    );
  });

  it("separates get evidence blocks with blank lines", async () => {
    await runArchiveCommand({
      action: "get",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/triple/Q1/mentions/Q2",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      [
        "-- evidence 1/2",
        "@@ wikg://chapter/2/source#1..2 @@",
        "RAG original source fragment.",
        "",
        "Second paragraph.",
        "",
        "-- evidence 2/2",
        "@@ wikg://chapter/2/source#4 @@",
        "Follow-up source fragment.",
      ].join("\n"),
    );
  });

  it("passes evidence pagination options", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikg:///tmp/book.wikg",
      context: 1,
      cursor: "cursor-1",
      format: "json",
      limit: 3,
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
      query: "paragraph",
    });

    expect(listArchiveEvidence).toHaveBeenCalledWith({}, "wikg://entity/Q1", {
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
      archivePath: "wikg:///tmp/book.wikg",
      context: 0,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
      query: "paragraph",
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
      query: "paragraph",
      sourceContext: 0,
      targetUri: "wikg://entity/Q1",
    });
  });

  it("prints evidence as JSONL", async () => {
    await runArchiveCommand({
      action: "evidence",
      archivePath: "wikg:///tmp/book.wikg",
      format: "jsonl",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wikg://chapter/2/source#1..2"',
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
      archivePath: "wikg:///tmp/book.wikg",
      format: "jsonl",
      limit: 1,
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(listArchiveEvidence).toHaveBeenNthCalledWith(
      1,
      {},
      "wikg://entity/Q1",
      { limit: 1 },
    );
    expect(listArchiveEvidence).toHaveBeenNthCalledWith(
      2,
      {},
      "wikg://entity/Q1",
      { cursor: "raw-next-evidence-cursor", limit: 1 },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain(
      '"uri":"wikg://chapter/2/source#1..2"',
    );
    expect(archiveMockState.textWrites[1]).toContain(
      '"uri":"wikg://chapter/2/source#4"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"page"');
    expect(archiveMockState.textWrites[1]).not.toContain('"type":"page"');
  });

  it("prints a context pack", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wikg:///tmp/book.wikg",
      budget: 1000,
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chunk/9",
    });

    expect(archiveMockState.textWrites[0]).toContain("Pack Budget: 1000");
    expect(archiveMockState.textWrites[0]).toContain("# Anchor");
    expect(archiveMockState.textWrites[0]).toContain("# Related");
    expect(archiveMockState.textWrites[0]).toContain("Source Fragments:");
    expect(archiveMockState.textWrites[0]).toContain(
      ["# Related", "wikg://chunk/11", "Related", "", "score: 3.5"].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "wikg://triple/Q1/mentions/Q2",
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
      archivePath: "wikg:///tmp/book.wikg",
      budget: 1000,
      evidenceLimit: 0,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chunk/9",
    });

    expect(archiveMockState.textWrites[0]).not.toContain('"evidence"');
  });

  it("prints a context pack as anchor plus related JSON", async () => {
    await runArchiveCommand({
      action: "pack",
      archivePath: "wikg:///tmp/book.wikg",
      budget: 1000,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/chunk/9",
    });

    const output = JSON.parse(archiveMockState.textWrites[0] ?? "") as Record<
      string,
      unknown
    >;

    expect(output).toMatchObject({
      anchor: {
        uri: "wikg://chunk/9",
      },
      related: {
        limit: 2,
        nextCursor: null,
        objects: [
          {
            uri: "wikg://chunk/11",
          },
          {
            evidence: {
              shown: 1,
            },
            uri: "wikg://triple/Q1/mentions/Q2",
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
    ).rejects.toThrow("Example: wikg:///tmp/book.wikg\nSee: wg help uri");
  });
});
