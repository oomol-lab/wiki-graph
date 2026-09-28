import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";

import { RESPONSE_INTENT_CLASSIFIER_PROMPT } from "./guaranteed/index.js";
import {
  BOOK_COHERENCE_PROMPT,
  CLUE_REVIEWER_GENERATOR_PROMPT,
  CLUE_REVIEWER_PROMPT,
  EVIDENCE_CHOICE_PROMPT,
  REVISION_FEEDBACK_PROMPT,
  TEXT_COMPRESSOR_PROMPT,
  TRANSLATE_CHUNKS_PROMPT,
  USER_FOCUSED_PROMPT,
} from "./prompt-assets.js";
import { renderJobPrompt } from "./template.js";

const PROMPTS = [
  RESPONSE_INTENT_CLASSIFIER_PROMPT,
  BOOK_COHERENCE_PROMPT,
  CLUE_REVIEWER_GENERATOR_PROMPT,
  CLUE_REVIEWER_PROMPT,
  EVIDENCE_CHOICE_PROMPT,
  REVISION_FEEDBACK_PROMPT,
  TEXT_COMPRESSOR_PROMPT,
  TRANSLATE_CHUNKS_PROMPT,
  USER_FOCUSED_PROMPT,
];

const VALUES = {
  acceptable_max: 120,
  acceptable_min: 80,
  compression_ratio: 0.2,
  evidence_selection_prompt: "Select <evidence> exactly.",
  extraction_guidance: "Keep named facts.",
  issues_description: "No issues.",
  metadata_field: "retention",
  original_length: 500,
  target_length: 100,
  thread_info: "Thread context.",
  user_focused_chunks: [
    { content: "Alpha", id: 1, label: "First" },
    { content: "Beta", id: 2, label: "Second" },
  ],
  user_language: "English",
  working_memory: "Prior context.",
};

describe("renderJobPrompt", () => {
  it.each(PROMPTS)("matches Nunjucks for every shipped prompt", (prompt) => {
    expect(renderJobPrompt(prompt, VALUES)).toBe(
      nunjucks.renderString(prompt, VALUES),
    );
  });

  it("matches false branches and empty loops", () => {
    const values = {
      ...VALUES,
      metadata_field: "importance",
      user_focused_chunks: [],
      user_language: "",
    };
    for (const prompt of PROMPTS) {
      expect(renderJobPrompt(prompt, values)).toBe(
        nunjucks.renderString(prompt, values),
      );
    }
  });
});
