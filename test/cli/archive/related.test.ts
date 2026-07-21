import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveMockState, resetArchiveMockState } from "./mock.js";
import { runArchiveCommand } from "../../../packages/cli/src/commands/index.js";
import {
  createContinuationCursor,
  listRelatedArchiveObjects,
} from "../../../packages/core/src/api/index.js";
import type { ArchiveListItem } from "../../../packages/core/src/retrieval/query/view.js";

beforeEach(resetArchiveMockState);

describe("cli/archive/related", () => {
  it("prints related objects", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wikg:///tmp/book.wikg",
      format: "text",
      objectId: "wikg:///tmp/book.wikg/chunk/9",
      query: "agent",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith(
      {},
      "wikg://chunk/9",
      { query: "agent" },
    );
    expect(archiveMockState.textWrites[0]).toContain("wikg://chunk/11");
    expect(archiveMockState.textWrites[0]).toContain("Related");
    expect(archiveMockState.textWrites[0]).toContain(
      [
        "wikg://chunk/11",
        "Related",
        "",
        "score: 3.5",
        "wikg://triple/Q1/mentions/Q2",
        "RAG(Q1) mentions agent(Q2)",
      ].join("\n"),
    );
    expect(archiveMockState.textWrites[0]).not.toContain("Related chunk");
    expect(archiveMockState.textWrites[0]).not.toContain("Q1 mentions Q2");
  });

  it("prints related triples as structured JSON", async () => {
    await runArchiveCommand({
      action: "related",
      archivePath: "wikg:///tmp/book.wikg",
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
    });

    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
      limit: 20,
      nextCursor: null,
      objects: [
        {
          label: "Related",
          type: "node",
          uri: "wikg://chunk/11",
        },
        {
          uri: "wikg://triple/Q1/mentions/Q2",
          predicate: "mentions",
          score: 3.5,
          subjectLabel: "RAG",
          objectLabel: "agent",
        },
      ],
    });
    expect(archiveMockState.textWrites[0]).toContain(
      [
        '      "uri": "wikg://triple/Q1/mentions/Q2",',
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
      archivePath: "wikg:///tmp/book.wikg",
      evidenceLimit: 3,
      format: "json",
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
      role: "subject",
    });

    expect(listRelatedArchiveObjects).toHaveBeenCalledWith(
      {},
      "wikg://entity/Q1",
      {
        evidenceLimit: 3,
        role: "subject",
      },
    );
    expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toMatchObject({
      objects: [
        {
          uri: "wikg://chunk/11",
        },
        {
          evidence: {
            shown: 1,
            sources: [
              {
                uri: "wikg://chapter/2/source#1..2",
              },
            ],
            total: 1,
          },
          uri: "wikg://triple/Q1/mentions/Q2",
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
      archivePath: "wikg:///tmp/book.wikg",
      format: "jsonl",
      limit: 1,
      objectId: "wikg:///tmp/book.wikg/entity/Q1",
      role: "subject",
    });

    expect(listRelatedArchiveObjects).toHaveBeenNthCalledWith(
      1,
      {},
      "wikg://entity/Q1",
      { limit: 1, role: "subject" },
    );
    expect(listRelatedArchiveObjects).toHaveBeenNthCalledWith(
      2,
      {},
      "wikg://entity/Q1",
      { cursor: "1", limit: 1, role: "subject" },
    );
    expect(createContinuationCursor).not.toHaveBeenCalled();
    expect(archiveMockState.textWrites[0]).toContain('"uri":"wikg://chunk/11"');
    expect(archiveMockState.textWrites[1]).toContain(
      '"uri":"wikg://triple/Q1/mentions/Q2"',
    );
    expect(archiveMockState.textWrites[0]).not.toContain('"type":"page"');
    expect(archiveMockState.textWrites[1]).not.toContain('"type":"page"');
  });
});
