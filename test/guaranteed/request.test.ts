import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  GuaranteedEmptyResponseError,
  GuaranteedParseValidationError,
  ParsedJsonError,
  SuspectedModelRefusalError,
  requestGuaranteedJson,
} from "../../src/guaranteed/index.js";
import type { LLMessage } from "../../src/llm/index.js";

const schema = z.object({
  value: z.number(),
});

describe("guaranteed/request", () => {
  it("retries natural-language replies without keeping broken assistant history", async () => {
    const request = vi
      .fn<
        (
          messages: readonly LLMessage[],
          retryIndex: number,
          retryMax: number,
        ) => Promise<string>
      >()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value": 3}');

    const result = await requestGuaranteedJson({
      messages: [
        {
          role: "user",
          content: "Return JSON",
        },
      ],
      parse: (data) => data.value,
      request,
      schema,
    });

    expect(result).toBe(3);
    expect(request).toHaveBeenCalledTimes(2);

    const secondCallMessages = request.mock.calls[1]?.[0];

    expect(secondCallMessages).toHaveLength(2);
    expect(secondCallMessages?.[1]).toMatchObject({
      role: "user",
    });
    expect(secondCallMessages?.[1]?.content).toContain("plain natural language");
  });

  it("treats consecutive non-JSON responses as a refusal", async () => {
    await expect(
      requestGuaranteedJson({
        messages: [],
        parse: (data) => data.value,
        request: () => Promise.resolve("I cannot answer that."),
        schema,
      }),
    ).rejects.toBeInstanceOf(SuspectedModelRefusalError);
  });

  it("retries empty responses and fails with an empty-response error", async () => {
    const request = vi
      .fn<
        (
          messages: readonly LLMessage[],
          retryIndex: number,
          retryMax: number,
        ) => Promise<string | undefined>
      >()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(undefined);

    await expect(
      requestGuaranteedJson({
        maxRetries: 1,
        messages: [],
        parse: (data) => data.value,
        request,
        schema,
      }),
    ).rejects.toBeInstanceOf(GuaranteedEmptyResponseError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("throws a parse validation error after exhausting retries", async () => {
    await expect(
      requestGuaranteedJson({
        maxRetries: 1,
        messages: [],
        parse: () => {
          throw new ParsedJsonError(["value is not acceptable"]);
        },
        request: () => Promise.resolve('{"value": 1}'),
        schema,
      }),
    ).rejects.toBeInstanceOf(GuaranteedParseValidationError);
  });

  it("keeps malformed JSON in history so the model can repair it", async () => {
    const request = vi
      .fn<
        (
          messages: readonly LLMessage[],
          retryIndex: number,
          retryMax: number,
        ) => Promise<string>
      >()
      .mockResolvedValueOnce('{"value": "\\uZZZZ"}')
      .mockResolvedValueOnce('{"value": 5}');

    const result = await requestGuaranteedJson({
      messages: [],
      parse: (data) => data.value,
      request,
      schema,
    });

    expect(result).toBe(5);

    const secondCallMessages = request.mock.calls[1]?.[0];

    expect(secondCallMessages).toHaveLength(2);
    expect(secondCallMessages?.[0]).toMatchObject({
      role: "assistant",
      content: '{"value": "\\uZZZZ"}',
    });
    expect(secondCallMessages?.[1]?.content).toContain("malformed JSON");
  });

  it("uses classifier fallback for ambiguous replies before deciding to keep history", async () => {
    const request = vi
      .fn<
        (
          messages: readonly LLMessage[],
          retryIndex: number,
          retryMax: number,
        ) => Promise<string>
      >()
      .mockResolvedValueOnce("value: 1")
      .mockResolvedValueOnce("malformed_json")
      .mockResolvedValueOnce('{"value": 7}');

    const result = await requestGuaranteedJson({
      messages: [],
      parse: (data) => data.value,
      request,
      schema,
    });

    expect(result).toBe(7);
    expect(request).toHaveBeenCalledTimes(3);

    const classifierMessages = request.mock.calls[1]?.[0];
    const retryMessages = request.mock.calls[2]?.[0];

    expect(classifierMessages?.[0]?.content).toContain(
      "Classify the raw assistant reply",
    );
    expect(retryMessages?.[0]).toMatchObject({
      role: "assistant",
      content: "value: 1",
    });
  });
});
