import { describe, expect, it, vi } from "vitest";

import { testWikispineRuntime } from "./wikispine.js";

describe("WikiSpine fetch provider", () => {
  it("preserves the gateway scope and sends the API key", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/readyz")) {
        return new Response("ready\n");
      }
      if (url.endsWith("/metadata")) {
        return Response.json({
          automaton_shard_count: 1,
          format: "wikispine-runtime-v1",
          qid_count: 1,
          surface_count: 1,
          surface_normalization: "unicode-nfc-casefold-v1",
        });
      }
      return new Response('{"type":"done","stats":{"matches":0}}\n', {
        headers: { "content-type": "application/x-ndjson" },
      });
    });

    await testWikispineRuntime({
      endpoint: "https://pdf-craft-api.oomol.dev/v1/wikispine",
      fetch: fetcher,
      provider: "fetch",
      token: "api-key",
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetcher.mock.calls) {
      expect(requestUrl(input)).toMatch(
        /^https:\/\/pdf-craft-api\.oomol\.dev\/v1\/wikispine\//u,
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer api-key",
      });
    }
  });

  it("rejects a missing API key before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      testWikispineRuntime({ fetch: fetcher, provider: "fetch" }),
    ).rejects.toThrow("requires a Bearer API key");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
