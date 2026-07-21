import { describe, expect, it } from "vitest";

import {
  cleanChunkTags,
  extractCompressedText,
  extractThinkingText,
} from "./response.js";

describe("editor/response", () => {
  it("removes chunk tags while keeping content", () => {
    expect(
      cleanChunkTags(
        '<chunk retention="verbatim">Alpha</chunk> <chunk>Beta</chunk>',
      ),
    ).toBe("Alpha Beta");
  });

  it("extracts the compressed text section from markdown output", () => {
    const response = [
      "Reasoning before final answer.",
      "",
      "## Compressed Text",
      "",
      "```text",
      "Line one.",
      "Line two.",
      "```",
      "",
      "---",
      "",
      "Ignored trailer.",
    ].join("\n");

    expect(extractCompressedText(response)).toBe("Line one.\nLine two.");
    expect(extractThinkingText(response)).toBe(
      "Reasoning before final answer.",
    );
  });

  it("falls back to the full response when no heading exists", () => {
    expect(extractCompressedText("```txt\nOnly body.\n```")).toBe("Only body.");
    expect(extractThinkingText("Only body.")).toBe("");
  });
});
