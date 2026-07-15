import { describe, expect, it } from "vitest";

import { WikiGraphScope } from "../../packages/core/src/common/llm-scope.js";
import {
  getScopeDefaults,
  resolveSamplingSetting,
  resolveTemperatureSetting,
} from "../../packages/core/src/llm/sampling.js";

describe("llm/sampling", () => {
  it("resolves static and ranged sampling values", () => {
    expect(resolveSamplingSetting(undefined, "temperature")).toBeUndefined();
    expect(resolveSamplingSetting(0.5, "temperature")).toBe(0.5);
    expect(resolveSamplingSetting([0.2], "temperature")).toBe(0.2);
    expect(resolveSamplingSetting([0.2, 0.8], "temperature", 1, 2)).toBe(0.5);
    expect(resolveTemperatureSetting([0.2, 0.8], 99, 2)).toBe(0.8);
  });

  it("rejects invalid range lengths", () => {
    expect(() => resolveSamplingSetting([0.1, 0.2, 0.3], "topP")).toThrow(
      "topP must be a number or a 2-item range like [0.6, 0.98]",
    );
  });

  it("resolves scoped defaults with fallback behavior", () => {
    expect(
      getScopeDefaults(
        WikiGraphScope.ReaderExtraction,
        undefined,
        [0.1, 0.2],
        0.9,
      ),
    ).toStrictEqual({
      temperature: [0.1, 0.2],
      topP: 0.9,
    });

    expect(
      getScopeDefaults(
        WikiGraphScope.ReaderExtraction,
        {
          [WikiGraphScope.ReaderExtraction]: {
            temperature: 0.4,
          },
        },
        0.2,
        0.9,
      ),
    ).toStrictEqual({
      temperature: 0.4,
      topP: 0.9,
    });
  });
});
