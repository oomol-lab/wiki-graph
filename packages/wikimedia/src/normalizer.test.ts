import { describe, expect, it, vi } from "vitest";

import { LlmDisambiguationNormalizer } from "./normalizer.js";
import type { WikimediaLlmRequest } from "./types.js";

describe("LlmDisambiguationNormalizer", () => {
  it("owns the prompt and retries meanings outside the page QID set", async () => {
    const request = vi
      .fn<WikimediaLlmRequest>()
      .mockResolvedValueOnce(
        JSON.stringify({
          meanings: [{ information: "invalid", qid: "Q404" }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          meanings: [{ information: "target", qid: "Q9" }],
        }),
      );
    const normalizer = new LlmDisambiguationNormalizer(request);

    const result = await normalizer.normalize({
      page: {
        items: [{ links: [{ qid: "Q9", title: "Target" }], text: "Target" }],
        links: [{ qid: "Q9", title: "Target" }],
        pageId: 1,
        revisionId: 2,
        text: "Target",
        title: "Example",
      },
      sourceQid: "Q1",
      wiki: "enwiki",
    });

    expect(result.meanings).toEqual([{ information: "target", qid: "Q9" }]);
    expect(request).toHaveBeenCalledTimes(2);
    const firstMessages = request.mock.calls[0]?.[0];
    expect(firstMessages?.[0]?.content).toContain("context");
  });
});
