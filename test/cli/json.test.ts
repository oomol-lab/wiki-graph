import { describe, expect, it } from "vitest";

import { formatCLIJSON } from "../../packages/cli/src/support/index.js";
import { formatCLIJSONLine } from "../../packages/cli/src/support/json.js";
import type { ArchiveFindHit, ArchiveEvidenceItem } from "wiki-graph-sdk";
import {
  createFindObject,
  createSourceObject,
  createObjectResultPage,
} from "../../packages/cli/src/commands/archive-output/object/objects.js";
import type { ArchiveOutputContext } from "../../packages/cli/src/commands/archive-output/object/types.js";

describe("cli/json", () => {
  it.each([formatCLIJSON, formatCLIJSONLine])(
    "keeps SDK raw signals out of CLI search, evidence and page output",
    async (format) => {
      const context: ArchiveOutputContext = {
        archiveKey: "test",
        archivePath: "/tmp/test.wikg",
        continuationCursorIsDurable: true,
        format: "json",
        indexScope: {
          kind: "archive-index",
          archivePath: "/tmp/test.wikg",
          archiveKey: "test",
        },
        limit: 1,
        evidenceLimit: 3,
        types: null,
      };
      const source: ArchiveEvidenceItem = {
        id: "wikg://chapter/1/source#1",
        type: "source",
        chapterId: 1,
        startSentenceIndex: 0,
        endSentenceIndex: 0,
        source: "text",
        title: "Title",
        score: 0.4,
      };
      const scoredSource = { ...source, ftsScore: -3, embeddingScore: 0 };
      const preview = {
        nextCursor: null,
        shown: 1,
        total: 1,
        sources: [source],
      };
      for (const type of ["source", "summary"] as const) {
        const hit: Extract<
          ArchiveFindHit,
          { readonly type: "source" | "summary" }
        > = {
          id: "wikg://chapter/1/" + type + "#1",
          type,
          field: type,
          snippet: "text",
          title: "Title",
          score: 0.5,
          evidence: preview,
        };
        const enriched = {
          ...hit,
          ftsScore: -12,
          embeddingScore: 0,
          evidence: { ...preview, sources: [scoredSource] },
        };
        const original = await createFindObject(hit, context);
        const actual = await createFindObject(enriched, context);
        expect(format(actual)).toBe(format(original));
        expect(format(createObjectResultPage([actual], "next-token", 1))).toBe(
          format(createObjectResultPage([original], "next-token", 1)),
        );
      }
      expect(format(createSourceObject(scoredSource))).toBe(
        format(createSourceObject(source)),
      );
      expect(
        format({ meta: { ftsScore: "user metadata", embeddingScore: 0 } }),
      ).toContain("user metadata");
    },
  );
  it("preserves JSON.stringify omission semantics while ordering keys", () => {
    expect(
      formatCLIJSON({
        b: undefined,
        a: "visible",
        c: [undefined, "item"],
      }),
    ).toBe(
      [
        "{",
        '  "a": "visible",',
        '  "c": [',
        "    null,",
        '    "item"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});
