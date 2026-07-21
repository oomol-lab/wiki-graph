import { describe, expect, it, vi } from "vitest";

import {
  createDisambiguationProfileNormalizer,
  type DisambiguationProfileNormalizerInput,
} from "./index.js";
import type { GuaranteedRequest } from "../guaranteed/index.js";

describe("wikipage/normalizer", () => {
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
