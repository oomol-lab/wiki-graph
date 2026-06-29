import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  type EvidenceQuoteScore,
  normalizeEvidenceDisplayText,
  normalizeEvidenceText,
  scoreEvidenceQuote,
} from "../../src/evidence-selection/index.js";

const FREUD_SENTENCES = [
  "西格蒙德·弗洛伊德（德語：Sigmund Freud，出生名：Sigismund Schlomo Freud；1856年5月6日—1939年9月23日），奥地利心理學家、精神分析学創始人、哲學家、性学家，二十世纪最有影響力的思想家之一。",
  "精神分析是对源于心理冲突的病理的一种评估和治疗的临床医学方法，通过患者和精神分析师之间的对话来进行，这门学科则包括由此衍生的独特心智理论和人类能动性。",
  "他生於奧地利帝國（今屬捷克）的一個犹太人家庭，1881年，他在維也納大學获得医学博士学位。",
  "1885 年完成特许任教资格后，他被任命为神经病理学講座教授，并于 1902 年成为副教授。",
  "1938年德国吞并奥地利後，因躲避納粹，弗洛伊德遷居英國倫敦。",
  "1939年于英国去世。",
  "弗洛伊德创立精神分析学时，发展了“自由联想”等治疗技术，并发现了移情这一概念且确立了其在分析过程中的核心作用。",
  "弗洛伊德将性欲的幼稚形式纳入其中，这使他将恋母情结制定为精神分析理论的核心原则。",
  "其将梦解释为愿望的满足，这为他提供了对症状形成和压抑（Repression）的潜在机制的临床分析模型。",
  "在此基础上，弗洛伊德阐述了他的潜意识理论，并继续发展由本我、自我与超我组成的心理结构模型。",
  "其著作《夢的解析》《性學三論》《圖騰與禁忌》等，提出了潛意識、本我、自我与超我、恋母情结、性冲动、心理防衛機制等概念，被譽為「精神分析之父」。",
] as const;

const REPORT_PATH = join(
  process.cwd(),
  "test/.reports/evidence-quote-score-report.json",
);

type ReportExpectation =
  | "ambiguous_high"
  | "low_confidence"
  | "ordered_penalty"
  | "weak_candidate"
  | "unique_high"
  | "unique_medium";

interface ReportCase {
  readonly expected: ReportExpectation;
  readonly expectedIndex?: number;
  readonly id: string;
  readonly mode: string;
  readonly note: string;
  readonly quote: string;
  readonly referenceCaseId?: string;
}

const REPORT_CASES: readonly ReportCase[] = [
  {
    expected: "unique_high",
    expectedIndex: 6,
    id: "exact_full_sentence",
    mode: "exact_or_substring",
    note: "完整原句，应该 exact=1，且 top1 明显突出。",
    quote: FREUD_SENTENCES[6]!,
  },
  {
    expected: "unique_high",
    expectedIndex: 6,
    id: "exact_substring",
    mode: "exact_or_substring",
    note: "句中连续摘录，应该是高分 substring，且 top1 明显突出。",
    quote: "发展了“自由联想”等治疗技术",
  },
  {
    expected: "unique_high",
    expectedIndex: 0,
    id: "normalized_latin_alias",
    mode: "normalization",
    note: "Latin 大小写与重音归一化后应高分命中。",
    quote: "sigmund freud",
  },
  {
    expected: "unique_high",
    expectedIndex: 2,
    id: "punctuation_and_width_normalization",
    mode: "normalization",
    note: "括号、分隔符和全半角差异归一化后应高分命中。",
    quote: "奧地利帝國 今屬捷克 的一個犹太人家庭",
  },
  {
    expected: "unique_high",
    expectedIndex: 9,
    id: "mention_tag_pollution",
    mode: "markup_pollution",
    note: "quote 中混入 mention 标签，strip 后仍应高分命中。",
    quote:
      '弗洛伊德阐述了他的<mention id="m1" qid="Q41631">潜意识理论</mention>',
  },
  {
    expected: "unique_high",
    expectedIndex: 6,
    id: "nested_markup_pollution",
    mode: "markup_pollution",
    note: "quote 中混入多个 XML-like 标签，strip 后仍应高分命中。",
    quote:
      '<quote><mention id="m2" qid="Q41631">弗洛伊德</mention>创立精神分析学</quote>',
  },
  {
    expected: "unique_medium",
    expectedIndex: 8,
    id: "omitted_middle_text",
    mode: "fuzzy_omission",
    note: "中间缺少连接词和英文括注，目标句应第一，gap 应明显，但分数不要求进入 exact 高分区。",
    quote: "梦解释为愿望的满足提供了对症状形成和压抑的临床分析模型",
  },
  {
    expected: "unique_medium",
    expectedIndex: 6,
    id: "omitted_middle_clause",
    mode: "fuzzy_omission",
    note: "省略中间谓语和修饰成分后，目标句仍应第一，gap 应明显。",
    quote: "弗洛伊德创立精神分析学发现移情核心作用",
  },
  {
    expected: "weak_candidate",
    expectedIndex: 10,
    id: "traditional_simplified_concepts",
    mode: "weak_variant_candidate",
    note: "理论术语存在简繁混杂时，目标句应第一但保持中等分。",
    quote: "梦的解析性学三论图腾与禁忌提出潜意识本我自我超我",
  },
  {
    expected: "ordered_penalty",
    expectedIndex: 8,
    id: "reordered_excerpt",
    mode: "order_penalty",
    note: "内容相关但顺序颠倒，应比对应的漏字摘录明显低分。",
    quote: "临床分析模型提供了梦解释为愿望的满足和压抑",
    referenceCaseId: "omitted_middle_text",
  },
  {
    expected: "ordered_penalty",
    expectedIndex: 6,
    id: "reordered_treatment_excerpt",
    mode: "order_penalty",
    note: "同一目标句内顺序颠倒，应比对应的顺序摘录低分。",
    quote: "移情核心作用发现了自由联想治疗技术",
    referenceCaseId: "exact_substring",
  },
  {
    expected: "unique_medium",
    expectedIndex: 4,
    id: "simplified_traditional_mix",
    mode: "fuzzy_variant",
    note: "简繁混杂，目标句应第一，gap 应明显，但分数不会被强行抬成高分。",
    quote: "躲避纳粹弗洛伊德迁居英国伦敦",
  },
  {
    expected: "unique_medium",
    expectedIndex: 3,
    id: "spaced_year_and_title",
    mode: "fuzzy_variant",
    note: "空格、年份和职称片段混合时，目标句应第一。",
    quote: "1885完成特许任教神经病理学教授1902副教授",
  },
  {
    expected: "ambiguous_high",
    id: "generic_short_quote",
    mode: "ambiguous_short",
    note: "短泛用 quote，多句高分且 gap 很小，应被视作 ambiguous。",
    quote: "弗洛伊德",
  },
  {
    expected: "ambiguous_high",
    id: "generic_psychoanalysis_quote",
    mode: "ambiguous_short",
    note: "常见主题词在多句出现时，应呈现高分歧义。",
    quote: "精神分析",
  },
  {
    expected: "low_confidence",
    id: "wrong_topic_quote",
    mode: "low_confidence",
    note: "不存在于句子集合的内容，整体低分，应要求 AI 重新提供或进入 fallback。",
    quote: "北京大学创办于清朝末年",
  },
  {
    expected: "low_confidence",
    id: "empty_quote",
    mode: "low_confidence",
    note: "空 quote 应整体为零分。",
    quote: "",
  },
  {
    expected: "low_confidence",
    id: "markup_only_quote",
    mode: "low_confidence",
    note: "只有标签、没有可见 quote 时，应整体为零分。",
    quote: '<mention id="m0" qid="Q0"></mention>',
  },
] as const;

describe("evidence-selection/quote-score", () => {
  it("normalizes display text without stripping visible punctuation", () => {
    expect(normalizeEvidenceDisplayText("  Alpha\n\tBeta\u200b  C++！ ")).toBe(
      "Alpha Beta C++!",
    );
    expect(normalizeEvidenceDisplayText("Ｈｅ said “hi”。")).toBe(
      "He said “hi”。",
    );
  });

  it("normalizes text with the wikispine surface-normalization contract", () => {
    expect(normalizeEvidenceText("Wikipedia_Title")).toBe("wikipedia title");
    expect(normalizeEvidenceText("Ｗｉｋｉｐｅｄｉａ")).toBe("wikipedia");
    expect(normalizeEvidenceText("Café")).toBe("cafe");
    expect(normalizeEvidenceText("Straße")).toBe("strasse");
    expect(normalizeEvidenceText("İstanbul")).toBe("istanbul");
    expect(normalizeEvidenceText("Alan​Turing")).toBe("alanturing");
    expect(normalizeEvidenceText("Jean‑Paul Sartre")).toBe("jean paul sartre");
    expect(normalizeEvidenceText("A---B")).toBe("a b");
    expect(normalizeEvidenceText("① theorem")).toBe("1 theorem");
    expect(normalizeEvidenceText("《北京大学》")).toBe("北京大学");
    expect(normalizeEvidenceText("西格蒙德·弗洛伊德")).toBe(
      "西格蒙德 弗洛伊德",
    );
    expect(normalizeEvidenceText("C++")).toBe("c++");
    expect(normalizeEvidenceText("C#")).toBe("c#");
    expect(normalizeEvidenceText("R&B")).toBe("r&b");
  });

  it("scores exact and substring evidence quotes highly", () => {
    const sentence = FREUD_SENTENCES[6]!;

    expect(scoreEvidenceQuote({ quote: sentence, sentence }).score).toBe(1);
    expect(
      scoreEvidenceQuote({
        quote: "发展了“自由联想”等治疗技术",
        sentence,
      }),
    ).toMatchObject({
      exactSubstring: true,
      strategy: "normalized_substring",
    });
    expect(
      scoreEvidenceQuote({
        quote: "发展了“自由联想”等治疗技术",
        sentence,
      }).score,
    ).toBeGreaterThan(0.95);
  });

  it("strips mention tags before scoring evidence quotes", () => {
    const sentence = FREUD_SENTENCES[9]!;
    const taggedQuote =
      '弗洛伊德阐述了他的<mention id="m1" qid="Q41631">潜意识理论</mention>';

    expect(
      scoreEvidenceQuote({ quote: taggedQuote, sentence }).score,
    ).toBeGreaterThan(0.95);
  });

  it("keeps fuzzy omissions high but penalizes reordered excerpts", () => {
    const sentence = FREUD_SENTENCES[8]!;
    const omitted = "梦解释为愿望的满足提供了对症状形成和压抑的临床分析模型";
    const reordered = "临床分析模型提供了梦解释为愿望的满足和压抑";

    const omittedScore = scoreEvidenceQuote({ quote: omitted, sentence }).score;
    const reorderedScore = scoreEvidenceQuote({
      quote: reordered,
      sentence,
    }).score;

    expect(omittedScore).toBeGreaterThan(0.65);
    expect(reorderedScore).toBeLessThan(omittedScore - 0.12);
  });

  it("ranks the intended sentence first for distorted Freud article quotes", () => {
    const quote = "躲避纳粹弗洛伊德迁居英国伦敦";
    const ranked = FREUD_SENTENCES.map((sentence, index) => ({
      index,
      sentence,
      score: scoreEvidenceQuote({ quote, sentence }).score,
    })).sort((left, right) => right.score - left.score);

    expect(ranked[0]).toMatchObject({ index: 4 });
    expect(ranked[0]!.score).toBeGreaterThan(0.58);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThan(0.15);
  });

  it("keeps generic short quotes ambiguous through candidate score gaps", () => {
    const quote = "弗洛伊德";
    const ranked = FREUD_SENTENCES.map((sentence, index) => ({
      index,
      score: scoreEvidenceQuote({ quote, sentence }).score,
    }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    expect(ranked[0]!.score).toBeGreaterThan(0.95);
    expect(ranked[1]!.score).toBeGreaterThan(0.95);
    expect(ranked[0]!.score - ranked[1]!.score).toBeLessThan(0.02);
  });

  it("writes an evidence quote score report with distribution checks", async () => {
    const cases = REPORT_CASES.map((item) => {
      const ranked = rankQuote(item.quote);
      const [top, second] = ranked;

      return {
        ...item,
        normalizedQuote: scoreEvidenceQuote({
          quote: item.quote,
          sentence: FREUD_SENTENCES[0]!,
        }).normalizedQuote,
        scoreStats: createScoreStats(
          ranked.map((candidate) => candidate.score),
        ),
        topGap:
          top === undefined || second === undefined
            ? null
            : roundScore(top.score - second.score),
        topCandidates: ranked.slice(0, 5),
      };
    });
    const casesById = new Map(cases.map((item) => [item.id, item]));
    const casesByExpectation = countBy(cases, (item) => item.expected);

    expect(casesByExpectation.get("ambiguous_high")).toBeGreaterThanOrEqual(2);
    expect(casesByExpectation.get("low_confidence")).toBeGreaterThanOrEqual(2);
    expect(casesByExpectation.get("ordered_penalty")).toBeGreaterThanOrEqual(2);
    expect(casesByExpectation.get("unique_high")).toBeGreaterThanOrEqual(3);
    expect(casesByExpectation.get("unique_medium")).toBeGreaterThanOrEqual(3);

    const casesByMode = countBy(cases, (item) => item.mode);

    expect(casesByMode.get("ambiguous_short")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("exact_or_substring")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("fuzzy_omission")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("fuzzy_variant")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("low_confidence")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("markup_pollution")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("normalization")).toBeGreaterThanOrEqual(2);
    expect(casesByMode.get("order_penalty")).toBeGreaterThanOrEqual(2);

    for (const item of cases) {
      const top = item.topCandidates[0];

      expect(top).toBeDefined();
      if (item.expectedIndex !== undefined) {
        expect(top).toMatchObject({ index: item.expectedIndex });
      }

      switch (item.expected) {
        case "unique_high":
          expect(top!.score).toBeGreaterThan(0.95);
          expect(item.topGap).toBeGreaterThan(0.45);
          break;
        case "unique_medium":
          expect(top!.score).toBeGreaterThan(0.55);
          expect(item.topGap).toBeGreaterThan(0.15);
          break;
        case "ordered_penalty": {
          const reference = casesById.get(item.referenceCaseId!);

          expect(reference).toBeDefined();
          expect(top!.score).toBeLessThan(
            reference!.topCandidates[0]!.score - 0.12,
          );
          break;
        }
        case "ambiguous_high":
          expect(top!.score).toBeGreaterThan(0.95);
          expect(item.topCandidates[1]?.score).toBeGreaterThan(0.95);
          expect(item.topGap).toBeLessThan(0.02);
          break;
        case "low_confidence":
          expect(top!.score).toBeLessThan(0.45);
          expect(item.scoreStats.mean).toBeLessThan(0.25);
          break;
        case "weak_candidate":
          expect(top!.score).toBeLessThan(0.55);
          expect(item.topGap).toBeLessThan(0.15);
          break;
      }
    }

    await mkdir(join(process.cwd(), "test/.reports"), { recursive: true });
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source:
            "zh.wikipedia.org/wiki/西格蒙德·弗洛伊德 excerpt, selected sentences",
          sentences: FREUD_SENTENCES.map((text, index) => ({
            id: `S${index + 1}`,
            index,
            text,
          })),
          cases,
        },
        null,
        2,
      )}\n`,
    );
  });
});

function rankQuote(quote: string): Array<{
  readonly exactNormalized: boolean;
  readonly exactRaw: boolean;
  readonly exactSubstring: boolean;
  readonly index: number;
  readonly matchEnd: number;
  readonly matchStart: number;
  readonly score: number;
  readonly sentence: string;
  readonly sentenceId: string;
  readonly strategy: EvidenceQuoteScore["strategy"];
}> {
  return FREUD_SENTENCES.map((sentence, index) => {
    const scored = scoreEvidenceQuote({ quote, sentence });

    return {
      exactNormalized: scored.exactNormalized,
      exactRaw: scored.exactRaw,
      exactSubstring: scored.exactSubstring,
      index,
      matchEnd: scored.matchEnd,
      matchStart: scored.matchStart,
      score: roundScore(scored.score),
      sentence,
      sentenceId: `S${index + 1}`,
      strategy: scored.strategy,
    };
  }).sort((left, right) => right.score - left.score);
}

function createScoreStats(scores: readonly number[]): {
  readonly max: number;
  readonly mean: number;
  readonly min: number;
  readonly range: number;
  readonly variance: number;
} {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const mean =
    scores.reduce((total, score) => total + score, 0) / scores.length;
  const variance =
    scores.reduce((total, score) => total + (score - mean) ** 2, 0) /
    scores.length;

  return {
    max: roundScore(max),
    mean: roundScore(mean),
    min: roundScore(min),
    range: roundScore(max - min),
    variance: roundScore(variance),
  };
}

function roundScore(score: number): number {
  return Number(score.toFixed(6));
}

function countBy<T>(
  items: readonly T[],
  select: (item: T) => string,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = select(item);

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}
