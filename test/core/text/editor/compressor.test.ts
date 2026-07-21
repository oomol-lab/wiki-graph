import { describe, expect, it } from "vitest";

import { WikiGraphScope } from "../../../../packages/core/src/runtime/common/llm-scope.js";
import { CompressionRequester } from "../../../../packages/core/src/text/editor/compressor.js";
import { TEXT_COMPRESSOR_PROMPT_TEMPLATE } from "../../../../packages/core/src/text/editor/prompt-templates.js";
import { ScriptedLLM } from "../../../helpers/scripted-llm.js";

describe("editor/compressor", () => {
  it("builds prompts and compression messages with revision history", async () => {
    const llm = new ScriptedLLM<WikiGraphScope>(["  compressed result  "]);
    const requester = new CompressionRequester(
      llm as never,
      WikiGraphScope.EditorCompress,
      0.25,
      "English",
    );

    const result = await requester.request({
      markedText: "Original marked text",
      previousCompressedText: "Previous compressed text",
      revisionFeedback: "Tighten the summary",
      targetLength: 100,
    });

    expect(result).toBe("compressed result");
    expect(llm.prompts).toStrictEqual([
      {
        templateContext: {
          acceptable_max: 114,
          acceptable_min: 85,
          compression_ratio: 25,
          original_length: 20,
          target_length: 100,
          user_language: "English",
        },
        templateName: TEXT_COMPRESSOR_PROMPT_TEMPLATE,
      },
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.options.scope).toBe(WikiGraphScope.EditorCompress);
    expect(llm.calls[0]?.messages.map((message) => message.role)).toStrictEqual(
      ["system", "user", "assistant", "user"],
    );
    const originalTextMessage = llm.calls[0]?.messages[1];

    expect(originalTextMessage?.role).toBe("user");
    expect(typeof originalTextMessage?.content).toBe("string");
    if (typeof originalTextMessage?.content !== "string") {
      throw new TypeError(
        "Expected original text message content to be a string",
      );
    }
    expect(originalTextMessage.content).toContain("Original marked text");
  });
});
