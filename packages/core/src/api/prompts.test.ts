import { describe, expect, test } from "vitest";

import {
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
  resolveExtractionPrompt,
  resolveKnowledgeGraphRecallPrompt,
} from "./prompts.js";

describe("prompt defaults", () => {
  test("resolves empty extraction prompts to the SDK default", () => {
    expect(resolveExtractionPrompt(undefined)).toBe(DEFAULT_EXTRACTION_PROMPT);
    expect(resolveExtractionPrompt("   ")).toBe(DEFAULT_EXTRACTION_PROMPT);
  });

  test("resolves empty Knowledge Graph recall prompts to the SDK default", () => {
    expect(resolveKnowledgeGraphRecallPrompt(undefined)).toBe(
      DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
    );
    expect(resolveKnowledgeGraphRecallPrompt("   ")).toBe(
      DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT,
    );
  });

  test("trims caller-provided prompts", () => {
    expect(resolveExtractionPrompt(" custom extraction ")).toBe(
      "custom extraction",
    );
    expect(resolveKnowledgeGraphRecallPrompt(" custom recall ")).toBe(
      "custom recall",
    );
  });
});
