import { readFile } from "fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createDisambiguationProfileNormalizer,
  type DisambiguationProfileNormalizerInput,
} from "./index.js";
import { renderDisambiguationHtml } from "./wikimedia-client/index.js";
import type { GuaranteedRequest } from "../guaranteed/index.js";

describe("wikipage/normalizer", () => {
  it("omits meanings without qids before returning the final profile", async () => {
    const input = createInput();
    const request = vi.fn<GuaranteedRequest>().mockResolvedValueOnce(
      JSON.stringify({
        meanings: [
          {
            category: "concept",
            information: "unlinked page item",
            name: "Unlinked meaning",
            priority: "primary",
            qid: null,
          },
          {
            category: "work",
            information: "empty qid page item",
            name: "Empty QID meaning",
            priority: "secondary",
            qid: "",
          },
          {
            category: "place",
            information: "美国首都",
            name: "华盛顿哥伦比亚特区",
            priority: "primary",
            qid: "Q61",
          },
        ],
        sourceQid: "Q25301",
        surface: "华盛顿",
      }),
    );

    await expect(
      createDisambiguationProfileNormalizer({ request })(input),
    ).resolves.toStrictEqual({
      meanings: [
        {
          category: "place",
          information: "美国首都",
          name: "华盛顿哥伦比亚特区",
          priority: "primary",
          qid: "Q61",
        },
      ],
      sourceQid: "Q25301",
      surface: "华盛顿",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("normalizes disambiguation page text and rejects invented qids", async () => {
    const input = createInput();
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValueOnce(
        JSON.stringify({
          meanings: [
            {
              information: "invented",
              name: "Invented",
              priority: "primary",
              qid: "Q999",
            },
          ],
          sourceQid: "Q25301",
          surface: "华盛顿",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          meanings: [
            {
              category: "person",
              information: "美国第一任总统",
              name: "乔治·华盛顿",
              priority: "primary",
              qid: "Q23",
            },
            {
              category: "place",
              information: "美国首都",
              name: "华盛顿哥伦比亚特区",
              priority: "primary",
              qid: "Q61",
            },
          ],
          sourceQid: "Q25301",
          surface: "华盛顿",
        }),
      );
    const normalize = createDisambiguationProfileNormalizer({ request });

    await expect(normalize(input)).resolves.toStrictEqual({
      meanings: [
        {
          category: "person",
          information: "美国第一任总统",
          name: "乔治·华盛顿",
          priority: "primary",
          qid: "Q23",
        },
        {
          category: "place",
          information: "美国首都",
          name: "华盛顿哥伦比亚特区",
          priority: "primary",
          qid: "Q61",
        },
      ],
      sourceQid: "Q25301",
      surface: "华盛顿",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls[1]?.[0]
        .map((message) =>
          typeof message.content === "string" ? message.content : "",
        )
        .join("\n"),
    ).toContain("Q999, but it is not present");
  });

  it("passes structured page items and linked QIDs to the LLM profile request", async () => {
    const fixture = JSON.parse(
      await readFile("test/fixtures/wikipage/zh-yangshan-parse.json", "utf8"),
    ) as { readonly parse: { readonly pageid: number; readonly text: string } };
    const rendered = renderDisambiguationHtml(fixture.parse.text);
    const input: DisambiguationProfileNormalizerInput = {
      pageQidLinks: [
        { qid: "Q15175", title: "广东省" },
        { qid: "Q286151", title: "阳山县" },
        { qid: "Q16963", title: "江苏省" },
        { qid: "Q42651", title: "无锡市" },
        { qid: "Q13779122", title: "阳山镇" },
      ],
      pages: [
        {
          linkedQids: [
            { qid: "Q15175", title: "广东省" },
            { qid: "Q286151", title: "阳山县" },
            { qid: "Q16963", title: "江苏省" },
            { qid: "Q42651", title: "无锡市" },
            { qid: "Q13779122", title: "阳山镇" },
          ],
          pageId: fixture.parse.pageid,
          text: rendered.text
            .replace(
              "wikigraph-title://%E5%B9%BF%E4%B8%9C%E7%9C%81",
              "wikg://qid=Q15175",
            )
            .replace(
              "wikigraph-title://%E9%98%B3%E5%B1%B1%E5%8E%BF",
              "wikg://qid=Q286151",
            )
            .replace(
              "wikigraph-title://%E6%B1%9F%E8%8B%8F%E7%9C%81",
              "wikg://qid=Q16963",
            )
            .replace(
              "wikigraph-title://%E6%97%A0%E9%94%A1%E5%B8%82",
              "wikg://qid=Q42651",
            )
            .replace(
              "wikigraph-title://%E9%98%B3%E5%B1%B1%E9%95%87",
              "wikg://qid=Q13779122",
            ),
          title: "阳山",
          wiki: "zhwiki",
        },
      ],
      sourceQid: "Q15880244",
      surface: "阳山",
    };
    const request = vi.fn<GuaranteedRequest>().mockResolvedValueOnce(
      JSON.stringify({
        meanings: [
          {
            category: "place",
            information: "广东省阳山县",
            name: "阳山县",
            priority: "primary",
            qid: "Q286151",
          },
          {
            category: "place",
            information: "江苏省无锡市阳山镇，被稱为中国水蜜桃之乡",
            name: "阳山镇",
            priority: "primary",
            qid: "Q13779122",
          },
        ],
        sourceQid: "Q15880244",
        surface: "阳山",
      }),
    );

    await createDisambiguationProfileNormalizer({ request })(input);

    const prompt = request.mock.calls[0]?.[0]
      .map((message) =>
        typeof message.content === "string" ? message.content : "",
      )
      .join("\n");
    expect(prompt).toContain("Structured disambiguation pages");
    expect(prompt).toContain('"pageid": 287840');
    expect(prompt).toContain('"wiki": "zhwiki"');
    expect(prompt).toContain('"text": "广东省阳山县"');
    expect(prompt).toContain('"qid": "Q15175"');
    expect(prompt).toContain('"qid": "Q286151"');
    expect(prompt).toContain(
      '"text": "江苏省无锡市阳山镇，被稱为中国水蜜桃之乡"',
    );
    expect(prompt).toContain('"qid": "Q16963"');
    expect(prompt).toContain('"qid": "Q42651"');
    expect(prompt).toContain('"qid": "Q13779122"');
    expect(prompt).toContain(
      "administrative divisions, parent locations, categories, and locator/explanatory links as context only",
    );
    expect(prompt).toContain(
      "Do not include context-only links as meanings unless the link itself is the disambiguated target.",
    );
  });
});

function createInput(): DisambiguationProfileNormalizerInput {
  return {
    pageQidLinks: [
      {
        qid: "Q23",
        title: "乔治·华盛顿",
      },
      {
        qid: "Q61",
        title: "华盛顿哥伦比亚特区",
      },
    ],
    pages: [
      {
        linkedQids: [
          {
            qid: "Q23",
            title: "乔治·华盛顿",
          },
          {
            qid: "Q61",
            title: "华盛顿哥伦比亚特区",
          },
        ],
        text:
          "* [[乔治·华盛顿|wikg://qid=Q23]]，美国第一任总统\n" +
          "* [[华盛顿哥伦比亚特区|wikg://qid=Q61]]，美国首都",
        title: "华盛顿",
        wiki: "zhwiki",
      },
    ],
    sourceQid: "Q25301",
    surface: "华盛顿",
  };
}
