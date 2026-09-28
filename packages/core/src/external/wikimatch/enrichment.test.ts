import { describe, expect, it, vi } from "vitest";

import { applyQidResolutions, enrichWikimatchCandidates } from "./index.js";

import type {
  WikimediaResolution,
  WikimediaResolveInput,
} from "../wikipage/index.js";

describe("wikimatch/enrichment", () => {
  it("adds language profiles and disambiguation information to qid options", () => {
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
        resolution("Q1087564", "朱元璋", "2006 Chinese television series"),
        {
          ...resolution("Q18165423", "朱元璋", null),
          disambiguation: [{ information: "明朝开国皇帝", qid: "Q9957" }],
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
        disambiguation: [{ information: "明朝开国皇帝", qid: "Q9957" }],
        isDisambiguation: true,
        label: "朱元璋",
        qid: "Q18165423",
      },
    ]);
  });

  it("passes WikiSpine disambiguation flags to the injected resolver", async () => {
    const resolve = vi.fn(
      (
        input: readonly WikimediaResolveInput[],
      ): Promise<readonly WikimediaResolution[]> =>
        Promise.resolve(
          input.map(({ qid }) =>
            resolution(qid, `label for ${qid}`, `description for ${qid}`),
          ),
        ),
    );

    await expect(
      enrichWikimatchCandidates(
        [
          {
            id: "c1",
            qidOptions: [
              { isDisambiguation: true, qid: "Q1" },
              { isDisambiguation: false, qid: "Q2" },
              { isDisambiguation: true, qid: "Q1" },
            ],
            range: { end: 8, start: 0 },
            surface: "universe",
          },
        ],
        { resolver: { resolve } },
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

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith([
      { disambiguation: true, qid: "Q1" },
      { disambiguation: false, qid: "Q2" },
    ]);
  });
});

function resolution(
  qid: string,
  label: string,
  description: string | null,
): WikimediaResolution {
  return {
    en: { description: null, label: null, url: null },
    qid,
    zh: { description, label, url: null },
  };
}
