import { expect, it } from "vitest";
import { z } from "zod";
import { requestGuaranteedJson } from "./request.js";
import { ParsedJsonError } from "./errors.js";

it("propagates a classifier provider error without treating it as a refusal", async () => {
  const error = new Error("provider unavailable");
  let calls = 0;
  await expect(
    requestGuaranteedJson({
      messages: [],
      schema: z.object({ value: z.number() }),
      responseIntentClassifierPrompt: "classify",
      request: () =>
        ++calls === 1 ? Promise.resolve("???") : Promise.reject(error),
      parse: (data) => data,
    }),
  ).rejects.toBe(error);
  expect(calls).toBe(2);
});

it("shares one absolute deadline across business repair and supports async parsing", async () => {
  const deadlines: (number | undefined)[] = [];
  let parses = 0;
  expect(
    await requestGuaranteedJson({
      messages: [],
      schema: z.object({ value: z.number() }),
      responseIntentClassifierPrompt: "classify",
      request: (_messages, _index, _max, execution) => {
        deadlines.push(execution?.deadline);
        return Promise.resolve('{"value":2}');
      },
      parse: async (data) => {
        await Promise.resolve();
        if (parses++ === 0) throw new ParsedJsonError(["try again"]);
        return data.value;
      },
    }),
  ).toBe(2);
  expect(deadlines).toHaveLength(2);
  expect(deadlines[0]).toBeTypeOf("number");
  expect(deadlines[1]).toBe(deadlines[0]);
});
