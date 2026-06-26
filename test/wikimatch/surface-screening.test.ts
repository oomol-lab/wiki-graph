import { describe, expect, it, vi } from "vitest";

import type { GuaranteedRequest } from "../../src/guaranteed/index.js";
import {
  buildWikimatchSurfaceWindows,
  judgeWikimatchSurfaceScreening,
  parseSurfaceScreeningResponse,
  type WikimatchCandidate,
} from "../../src/wikimatch/index.js";
import { ParsedJsonError } from "../../src/guaranteed/index.js";

describe("wikimatch/surface-screening", () => {
  it("screens plain surfaces without qids", async () => {
    const input = createInput();
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        surfaces: [
          {
            decision: "allow",
            note: "神学语境",
            surfaceId: "s1",
          },
          {
            decision: "global_blocklist_candidate",
            note: "纯数字",
            surfaceId: "s2",
          },
        ],
      }),
    );

    const result = await judgeWikimatchSurfaceScreening({
      ...input,
      request,
    });

    expect(request.mock.calls[0]?.[0][0]?.content).toContain(
      "User recall policy:\n只召回神学实体。",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).toContain("Context:");
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      '"surfaceId": "s1"',
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain("qid");
    expect(result.surfaces).toStrictEqual([
      {
        decision: "allow",
        note: "神学语境",
        surfaceId: "s1",
        text: "恩典",
      },
      {
        decision: "global_blocklist_candidate",
        note: "纯数字",
        surfaceId: "s2",
        text: "1234",
      },
    ]);
  });

  it("rejects missing surface results", () => {
    const input = createInput();

    try {
      parseSurfaceScreeningResponse(input.window.surfaces, {
        surfaces: [
          {
            decision: "allow",
            surfaceId: "s1",
          },
        ],
      });
      throw new Error("Expected parseSurfaceScreeningResponse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ParsedJsonError);
      expect((error as ParsedJsonError).issues[0]).toContain(
        "Missing result for s2",
      );
    }
  });
});

function createInput(): {
  readonly policyPrompt: string;
  readonly window: ReturnType<typeof buildWikimatchSurfaceWindows>[number];
} {
  const text = "恩典在神学语境中很重要。1234 不重要。";
  const candidates: WikimatchCandidate[] = [
    candidate("c1", "恩典", 0, 2),
    candidate("c2", "1234", 13, 17),
  ];
  const [window] = buildWikimatchSurfaceWindows({
    candidates,
    contextWords: 20,
    surfaceBudget: 10,
    text,
  });

  if (window === undefined) {
    throw new Error("Missing test window");
  }

  return {
    policyPrompt: "只召回神学实体。",
    window,
  };
}

function candidate(
  id: string,
  surface: string,
  start: number,
  end: number,
): WikimatchCandidate {
  return {
    id,
    qidOptions: [],
    range: { end, start },
    surface,
  };
}
