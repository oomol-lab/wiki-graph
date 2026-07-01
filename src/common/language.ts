export enum Language {
  Arabic = "Arabic",
  Danish = "Danish",
  Dutch = "Dutch",
  English = "English",
  Finnish = "Finnish",
  French = "French",
  German = "German",
  Hindi = "Hindi",
  Indonesian = "Indonesian",
  Italian = "Italian",
  Japanese = "Japanese",
  Korean = "Korean",
  Norwegian = "Norwegian",
  Polish = "Polish",
  Portuguese = "Portuguese",
  Russian = "Russian",
  SimplifiedChinese = "Simplified Chinese",
  Spanish = "Spanish",
  Swedish = "Swedish",
  Thai = "Thai",
  TraditionalChinese = "Traditional Chinese",
  Turkish = "Turkish",
  Vietnamese = "Vietnamese",
}

export enum LanguageCode {
  Arabic = "ar",
  Chinese = "zh",
  Danish = "da",
  Dutch = "nl",
  English = "en",
  Finnish = "fi",
  French = "fr",
  German = "de",
  Hindi = "hi",
  Indonesian = "id",
  Italian = "it",
  Japanese = "ja",
  Korean = "ko",
  Norwegian = "no",
  Polish = "pl",
  Portuguese = "pt",
  Russian = "ru",
  Spanish = "es",
  Swedish = "sv",
  Thai = "th",
  Turkish = "tr",
  Vietnamese = "vi",
}

const LANGUAGE_TO_CODE = {
  [Language.Arabic]: LanguageCode.Arabic,
  [Language.Danish]: LanguageCode.Danish,
  [Language.Dutch]: LanguageCode.Dutch,
  [Language.English]: LanguageCode.English,
  [Language.Finnish]: LanguageCode.Finnish,
  [Language.French]: LanguageCode.French,
  [Language.German]: LanguageCode.German,
  [Language.Hindi]: LanguageCode.Hindi,
  [Language.Indonesian]: LanguageCode.Indonesian,
  [Language.Italian]: LanguageCode.Italian,
  [Language.Japanese]: LanguageCode.Japanese,
  [Language.Korean]: LanguageCode.Korean,
  [Language.Norwegian]: LanguageCode.Norwegian,
  [Language.Polish]: LanguageCode.Polish,
  [Language.Portuguese]: LanguageCode.Portuguese,
  [Language.Russian]: LanguageCode.Russian,
  [Language.SimplifiedChinese]: LanguageCode.Chinese,
  [Language.Spanish]: LanguageCode.Spanish,
  [Language.Swedish]: LanguageCode.Swedish,
  [Language.Thai]: LanguageCode.Thai,
  [Language.TraditionalChinese]: LanguageCode.Chinese,
  [Language.Turkish]: LanguageCode.Turkish,
  [Language.Vietnamese]: LanguageCode.Vietnamese,
} satisfies Record<Language, LanguageCode>;

const LANGUAGE_CODE_TO_PROMPT_LANGUAGE = {
  [LanguageCode.Arabic]: Language.Arabic,
  [LanguageCode.Chinese]: Language.SimplifiedChinese,
  [LanguageCode.Danish]: Language.Danish,
  [LanguageCode.Dutch]: Language.Dutch,
  [LanguageCode.English]: Language.English,
  [LanguageCode.Finnish]: Language.Finnish,
  [LanguageCode.French]: Language.French,
  [LanguageCode.German]: Language.German,
  [LanguageCode.Hindi]: Language.Hindi,
  [LanguageCode.Indonesian]: Language.Indonesian,
  [LanguageCode.Italian]: Language.Italian,
  [LanguageCode.Japanese]: Language.Japanese,
  [LanguageCode.Korean]: Language.Korean,
  [LanguageCode.Norwegian]: Language.Norwegian,
  [LanguageCode.Polish]: Language.Polish,
  [LanguageCode.Portuguese]: Language.Portuguese,
  [LanguageCode.Russian]: Language.Russian,
  [LanguageCode.Spanish]: Language.Spanish,
  [LanguageCode.Swedish]: Language.Swedish,
  [LanguageCode.Thai]: Language.Thai,
  [LanguageCode.Turkish]: Language.Turkish,
  [LanguageCode.Vietnamese]: Language.Vietnamese,
} satisfies Record<LanguageCode, Language>;

const LANGUAGE_CODE_ALIASES = new Map<string, LanguageCode>([
  ["arabic", LanguageCode.Arabic],
  ["da", LanguageCode.Danish],
  ["danish", LanguageCode.Danish],
  ["de", LanguageCode.German],
  ["deu", LanguageCode.German],
  ["dut", LanguageCode.Dutch],
  ["dutch", LanguageCode.Dutch],
  ["en", LanguageCode.English],
  ["eng", LanguageCode.English],
  ["english", LanguageCode.English],
  ["fi", LanguageCode.Finnish],
  ["fin", LanguageCode.Finnish],
  ["finnish", LanguageCode.Finnish],
  ["fr", LanguageCode.French],
  ["fra", LanguageCode.French],
  ["fre", LanguageCode.French],
  ["french", LanguageCode.French],
  ["ger", LanguageCode.German],
  ["german", LanguageCode.German],
  ["hi", LanguageCode.Hindi],
  ["hin", LanguageCode.Hindi],
  ["hindi", LanguageCode.Hindi],
  ["id", LanguageCode.Indonesian],
  ["ind", LanguageCode.Indonesian],
  ["indonesian", LanguageCode.Indonesian],
  ["it", LanguageCode.Italian],
  ["ita", LanguageCode.Italian],
  ["italian", LanguageCode.Italian],
  ["ja", LanguageCode.Japanese],
  ["japanese", LanguageCode.Japanese],
  ["jpn", LanguageCode.Japanese],
  ["ko", LanguageCode.Korean],
  ["kor", LanguageCode.Korean],
  ["korean", LanguageCode.Korean],
  ["nl", LanguageCode.Dutch],
  ["no", LanguageCode.Norwegian],
  ["nor", LanguageCode.Norwegian],
  ["norwegian", LanguageCode.Norwegian],
  ["pl", LanguageCode.Polish],
  ["pol", LanguageCode.Polish],
  ["polish", LanguageCode.Polish],
  ["por", LanguageCode.Portuguese],
  ["portuguese", LanguageCode.Portuguese],
  ["pt", LanguageCode.Portuguese],
  ["ru", LanguageCode.Russian],
  ["rus", LanguageCode.Russian],
  ["russian", LanguageCode.Russian],
  ["spa", LanguageCode.Spanish],
  ["spanish", LanguageCode.Spanish],
  ["sv", LanguageCode.Swedish],
  ["swe", LanguageCode.Swedish],
  ["swedish", LanguageCode.Swedish],
  ["th", LanguageCode.Thai],
  ["tha", LanguageCode.Thai],
  ["thai", LanguageCode.Thai],
  ["tr", LanguageCode.Turkish],
  ["tur", LanguageCode.Turkish],
  ["turkish", LanguageCode.Turkish],
  ["vi", LanguageCode.Vietnamese],
  ["vie", LanguageCode.Vietnamese],
  ["vietnamese", LanguageCode.Vietnamese],
  ["zh", LanguageCode.Chinese],
  ["zh-cn", LanguageCode.Chinese],
  ["zh-hans", LanguageCode.Chinese],
  ["zh-sg", LanguageCode.Chinese],
  ["zh-tw", LanguageCode.Chinese],
  ["zh-hant", LanguageCode.Chinese],
  ["zh-hk", LanguageCode.Chinese],
  ["cn", LanguageCode.Chinese],
  ["chi", LanguageCode.Chinese],
  ["chinese", LanguageCode.Chinese],
  ["simplified chinese", LanguageCode.Chinese],
  ["traditional chinese", LanguageCode.Chinese],
  ["zho", LanguageCode.Chinese],
]);

export function getLanguageCode(language: Language): LanguageCode {
  return LANGUAGE_TO_CODE[language];
}

export function formatLanguageForPrompt(code: LanguageCode): Language {
  return LANGUAGE_CODE_TO_PROMPT_LANGUAGE[code];
}

export function normalizeLanguageCode(
  language: Language | string | null | undefined,
): LanguageCode | undefined {
  const normalized = language?.trim().toLowerCase().replaceAll("_", "-");

  if (normalized === undefined || normalized === "") {
    return undefined;
  }

  return LANGUAGE_CODE_ALIASES.get(normalized);
}

export function getWikipageLanguageCode(
  language: Language | string | null | undefined,
): "en" | "zh" | undefined {
  const code = normalizeLanguageCode(language);

  if (code === LanguageCode.English || code === LanguageCode.Chinese) {
    return code;
  }

  return undefined;
}
