import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  buildBusinessErrorMessage,
  buildSchemaErrorMessage,
  buildSyntaxErrorMessage,
  extractJsonText,
  listSchemaIssues,
  repairJsonText,
} from "./response.js";

describe("guaranteed/response", () => {
  it("extracts JSON from fenced responses", () => {
    const response = [
      "Here is the result:",
      "```json",
      '{"value": 1}',
      "```",
    ].join("\n");

    expect(extractJsonText(response)).toBe('{"value": 1}');
  });

  it("extracts top-level JSON arrays without collapsing to inner objects", () => {
    const response = 'Result: [{"value": 1}]';

    expect(extractJsonText(response)).toBe('[{"value": 1}]');
  });

  it("repairs simple malformed JSON when possible", () => {
    expect(repairJsonText('{"value": 1,}')).toBe('{"value": 1}');
  });

  it("formats syntax, schema, and business error messages", () => {
    const syntaxMessage = buildSyntaxErrorMessage(
      new SyntaxError("Unexpected token } in JSON"),
    );
    const schema = z.object({
      value: z.number(),
    });
    const parsed = schema.safeParse({
      value: "wrong",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected schema parsing to fail");
    }

    const schemaIssues = listSchemaIssues(parsed.error);
    const schemaMessage = buildSchemaErrorMessage(parsed.error);
    const businessMessage = buildBusinessErrorMessage([
      "value must be positive",
    ]);

    expect(syntaxMessage).toContain("syntax error");
    expect(schemaIssues[0]).toContain("value");
    expect(schemaMessage).toContain("structural issues");
    expect(businessMessage).toContain("value must be positive");
  });
});
