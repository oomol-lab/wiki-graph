import { describe, expect, it } from "vitest";

import {
  formatLanguageForPrompt,
  getLanguageCode,
  getWikipageLanguageCode,
  Language,
  LanguageCode,
  normalizeLanguageCode,
} from "../../packages/core/src/runtime/common/language.js";
import { getLanguageDetectionCode } from "../../packages/core/src/runtime/common/tinyld-language.js";

describe("common/language", () => {
  it("exposes a stable language list", () => {
    const languages = Object.values(Language);

    expect(languages).toContain(Language.English);
    expect(languages).toContain(Language.SimplifiedChinese);
    expect(new Set(languages).size).toBe(languages.length);
  });

  it("maps languages to detection codes", () => {
    expect(getLanguageDetectionCode(Language.English)).toBe("en");
    expect(getLanguageDetectionCode(Language.SimplifiedChinese)).toBe("zh");
  });

  it("normalizes language aliases to canonical project codes", () => {
    expect(getLanguageCode(Language.TraditionalChinese)).toBe(
      LanguageCode.Chinese,
    );
    expect(normalizeLanguageCode("cn")).toBe(LanguageCode.Chinese);
    expect(normalizeLanguageCode("zh-CN")).toBe(LanguageCode.Chinese);
    expect(normalizeLanguageCode("zh_TW")).toBe(LanguageCode.Chinese);
    expect(normalizeLanguageCode("ar")).toBe(LanguageCode.Arabic);
    expect(normalizeLanguageCode("es")).toBe(LanguageCode.Spanish);
    expect(normalizeLanguageCode(Language.SimplifiedChinese)).toBe(
      LanguageCode.Chinese,
    );
    expect(getWikipageLanguageCode("zh-Hant")).toBe("zh");
    expect(formatLanguageForPrompt(LanguageCode.English)).toBe(
      Language.English,
    );
  });
});
