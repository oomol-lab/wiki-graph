import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectMock, validateISO2Mock } = vi.hoisted(() => ({
  detectMock: vi.fn<(text: string) => string>(),
  validateISO2Mock: vi.fn<(value: string) => string>(),
}));

vi.mock("tinyld", () => ({
  detect: detectMock,
  validateISO2: validateISO2Mock,
}));

import { checkOutputLanguage } from "./language-review.js";
import { ReviewSeverity } from "./types.js";
import { Language } from "../../runtime/common/language.js";

describe("editor/language-review", () => {
  beforeEach(() => {
    detectMock.mockReset();
    validateISO2Mock.mockReset();
    validateISO2Mock.mockImplementation((value: string) => {
      return value === "en" || value === "ja" ? value : "";
    });
  });

  it("returns undefined when output already matches the requested language", () => {
    detectMock.mockReturnValue("en");

    expect(
      checkOutputLanguage({
        compressedText: "English summary",
        userLanguage: Language.English,
      }),
    ).toBeUndefined();
  });

  it("returns a critical review when output language mismatches the requested language", () => {
    detectMock.mockReturnValue("ja-JP");

    const result = checkOutputLanguage({
      compressedText: "こんにちは世界",
      userLanguage: Language.English,
    });

    expect(result).toMatchObject({
      detectedLanguageCode: "ja",
      targetLanguageCode: "en",
      review: {
        clueId: -1,
        issues: [
          {
            severity: ReviewSeverity.Critical,
          },
        ],
        weight: 1,
      },
    });
    expect(result?.review.issues[0]?.problem).toContain("detected ja");
    expect(result?.review.issues[0]?.suggestion).toContain("English");
  });
});
