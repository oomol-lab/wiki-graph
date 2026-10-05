import { describe, expect, it, vi } from "vitest";

import { applyQidResolutions, enrichWikimatchCandidates } from "./index.js";

import type {
  JobWikimediaResolution as WikimediaResolution,
  JobWikimediaResolver,
} from "../../ports.js";

type WikimediaResolveInput = Parameters<
  JobWikimediaResolver["resolve"]
>[0][number];

describe("wikimatch/enrichment", () => {
  it("fails the operation when a resolver errors after a partial result", async () => {
    const progress: number[] = [];
    const enriching = enrichWikimatchCandidates(
      [
        {
          id: "c1",
          qidOptions: [
            { isDisambiguation: false, qid: "Q1" },
            { isDisambiguation: false, qid: "Q2" },
          ],
          range: { end: 1, start: 0 },
          surface: "x",
        },
      ],
      {
        onProgress: (done) => {
          progress.push(done);
        },
        resolver: {
          resolve: async function* () {
            await Promise.resolve();
            yield { index: 0, resolution: resolution("Q1", "one", null) };
            throw new Error("stream failed");
          },
        },
      },
    );

    await expect(enriching).rejects.toThrow("stream failed");
    expect(progress).toStrictEqual([1]);
  });

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
        { disambiguation: false, qid: "Q1087564" },
        { disambiguation: true, qid: "Q18165423" },
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
    const resolve = vi.fn(async function* (
      input: readonly WikimediaResolveInput[],
    ) {
      await Promise.resolve();
      for (const [index, { qid }] of input.entries()) {
        yield {
          index,
          resolution: resolution(
            qid,
            `label for ${qid}`,
            `description for ${qid}`,
          ),
        };
      }
    });

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

  it("keeps mixed disambiguation inputs distinct when results arrive out of order", async () => {
    const candidates = await enrichWikimatchCandidates(
      [
        {
          id: "c1",
          qidOptions: [
            { isDisambiguation: true, qid: "Q1" },
            { isDisambiguation: false, qid: "Q1" },
          ],
          range: { end: 1, start: 0 },
          surface: "x",
        },
      ],
      {
        resolver: {
          resolve: async function* () {
            await Promise.resolve();
            yield { index: 1, resolution: resolution("Q1", "plain", null) };
            yield {
              index: 0,
              resolution: {
                ...resolution("Q1", "disambiguation", null),
                disambiguation: [{ information: "meaning", qid: "Q2" }],
              },
            };
          },
        },
      },
    );

    expect(candidates[0]?.qidOptions).toMatchObject([
      { disambiguation: [{ qid: "Q2" }], label: "disambiguation" },
      { label: "plain" },
    ]);
  });

  it("rejects missing and duplicate resolver indexes", async () => {
    const candidates = [
      {
        id: "c1",
        qidOptions: [
          { isDisambiguation: false, qid: "Q1" },
          { isDisambiguation: false, qid: "Q2" },
        ],
        range: { end: 1, start: 0 },
        surface: "x",
      },
    ];
    await expect(
      enrichWikimatchCandidates(candidates, {
        resolver: {
          resolve: async function* () {
            await Promise.resolve();
            yield { index: 0, resolution: resolution("Q1", "one", null) };
          },
        },
      }),
    ).rejects.toThrow("ended after 1 of 2 results");
    await expect(
      enrichWikimatchCandidates(candidates, {
        resolver: {
          resolve: async function* () {
            await Promise.resolve();
            yield { index: 0, resolution: resolution("Q1", "one", null) };
            yield { index: 0, resolution: resolution("Q1", "one", null) };
          },
        },
      }),
    ).rejects.toThrow("input index 0 twice");
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
