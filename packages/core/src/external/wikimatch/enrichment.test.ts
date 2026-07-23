import { describe, expect, it, vi } from "vitest";

import { applyQidResolutions, enrichWikimatchCandidates } from "./index.js";

import type { QidResolution } from "../wikipage/index.js";

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

  it("uses an injected resolver without closing external resources", async () => {
    const resolveQids = vi.fn(
      (qids: readonly string[]): Promise<readonly QidResolution[]> =>
        Promise.resolve(
          qids.map((qid) => ({
            description: `description for ${qid}`,
            isDisambiguation: false,
            label: `label for ${qid}`,
            qid,
          })),
        ),
    );
    const close = vi.fn();
    const resolver = { close, resolveQids };

    await expect(
      enrichWikimatchCandidates(
        [
          {
            id: "c1",
            qidOptions: [
              { isDisambiguation: false, qid: "Q1" },
              { isDisambiguation: false, qid: "Q2" },
              { isDisambiguation: false, qid: "Q1" },
            ],
            range: { end: 8, start: 0 },
            surface: "universe",
          },
        ],
        { resolver },
      ),
    ).resolves.toMatchObject([
      {
        qidOptions: [
          {
            description: "description for Q1",
            label: "label for Q1",
            qid: "Q1",
          },
          {
            description: "description for Q2",
            label: "label for Q2",
            qid: "Q2",
          },
          {
            description: "description for Q1",
            label: "label for Q1",
            qid: "Q1",
          },
        ],
      },
    ]);

    expect(resolveQids).toHaveBeenCalledTimes(1);
    expect(resolveQids).toHaveBeenCalledWith(["Q1", "Q2"]);
    expect(close).not.toHaveBeenCalled();
  });
});
