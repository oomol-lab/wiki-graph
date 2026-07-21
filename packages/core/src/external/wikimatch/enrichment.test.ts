import { describe, expect, it } from "vitest";

import { applyQidResolutions } from "./index.js";

describe("wikimatch/enrichment", () => {
  it("adds descriptions and disambiguation information to qid options", () => {
    const [candidate] = applyQidResolutions(
      [
        {
          id: "c1",
          qidOptions: [
            { isDisambiguation: false, qid: "Q1087564" },
            { isDisambiguation: true, qid: "Q18165423" },
          ],
          range: { end: 3, start: 0 },
          surface: "朱元璋",
        },
      ],
      [
        {
          description: "2006 Chinese television series",
          isDisambiguation: false,
          label: "朱元璋",
          qid: "Q1087564",
        },
        {
          disambiguation: {
            checkedAt: "2026-06-27T00:00:00.000Z",
            disambiguationQid: "Q18165423",
            linkedQids: [{ qid: "Q9957", title: "朱元璋" }],
            pages: [],
            profile: {
              meanings: [
                {
                  information: "明朝开国皇帝",
                  name: "朱元璋",
                  priority: "primary",
                  qid: "Q9957",
                },
              ],
              sourceQid: "Q18165423",
            },
          },
          isDisambiguation: true,
          label: "朱元璋",
          qid: "Q18165423",
        },
      ],
    );

    expect(candidate?.qidOptions).toStrictEqual([
      {
        description: "2006 Chinese television series",
        isDisambiguation: false,
        label: "朱元璋",
        qid: "Q1087564",
      },
      {
        disambiguation: {
          checkedAt: "2026-06-27T00:00:00.000Z",
          disambiguationQid: "Q18165423",
          linkedQids: [{ qid: "Q9957", title: "朱元璋" }],
          pages: [],
          profile: {
            meanings: [
              {
                information: "明朝开国皇帝",
                name: "朱元璋",
                priority: "primary",
                qid: "Q9957",
              },
            ],
            sourceQid: "Q18165423",
          },
        },
        isDisambiguation: true,
        label: "朱元璋",
        qid: "Q18165423",
      },
    ]);
  });
});
