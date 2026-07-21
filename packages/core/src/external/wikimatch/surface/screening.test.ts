import { describe, expect, it, vi } from "vitest";

import type { GuaranteedRequest } from "../../guaranteed/index.js";
import {
  judgeWikimatchSurfaceProtection,
  parseSurfaceProtectionResponse,
  type WikimatchSurface,
} from "../index.js";
import { ParsedJsonError } from "../../guaranteed/index.js";

describe("wikimatch/surface-screening", () => {
  it("asks the model to protect useful high-frequency surfaces only", async () => {
    const request = vi.fn<GuaranteedRequest>().mockResolvedValue(
      JSON.stringify({
        protectedSurfaces: [
          {
            note: "人物",
            surfaceId: "s2",
          },
        ],
      }),
    );

    const result = await judgeWikimatchSurfaceProtection({
      policyPrompt: "只召回主线人物和关键地点。",
      request,
      suspiciousSurfaces: createSurfaces(),
    });

    expect(request.mock.calls[0]?.[0][0]?.content).toContain(
      "A surface that is not protected will be removed before grounding.",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      "Suspicious high-frequency surfaces:",
    );
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      '"protectedSurfaces"',
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain(
      "skip_this_time",
    );
    expect(result.protectedSurfaces).toStrictEqual([
      {
        note: "人物",
        surfaceId: "s2",
        text: "陈友谅",
      },
    ]);
  });

  it("rejects protected surface ids outside the suspicious pool", () => {
    try {
      parseSurfaceProtectionResponse(createSurfaces(), {
        protectedSurfaces: [
          {
            surfaceId: "missing",
          },
        ],
      });
      throw new Error("Expected parseSurfaceProtectionResponse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ParsedJsonError);
      expect((error as ParsedJsonError).issues[0]).toContain(
        'Unknown surfaceId "missing"',
      );
    }
  });
});

function createSurfaces(): readonly WikimatchSurface[] {
  return [
    {
      count: 302,
      id: "s1",
      text: "的",
    },
    {
      count: 87,
      id: "s2",
      text: "陈友谅",
    },
  ];
}
