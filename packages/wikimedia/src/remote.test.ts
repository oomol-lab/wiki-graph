import { describe, expect, it, vi } from "vitest";

import type { WikimediaServiceError } from "./remote.js";
import { HttpWikimediaResolver } from "./remote.js";

describe("HttpWikimediaResolver", () => {
  it("uses the service route for a root endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ results: [] }));
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );

    await resolver.resolve([]);

    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://service.example/v1/qids:resolve"),
      expect.any(Object),
    );
  });

  it("rejects a missing API key before making a request", () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(
      () => new HttpWikimediaResolver("https://service.example", "", fetcher),
    ).toThrow("requires a Bearer API key");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports an omitted API key as a configuration error", () => {
    expect(
      () => new HttpWikimediaResolver("https://service.example", undefined),
    ).toThrow("requires a Bearer API key");
  });

  it("preserves a gateway scope and sends the API key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ results: [] }));
    const resolver = new HttpWikimediaResolver(
      "https://pdf-craft-api.oomol.dev/v1/wg-wikimedia/",
      "api-key",
      fetcher,
    );

    await resolver.resolve([]);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toStrictEqual(
      new URL("https://pdf-craft-api.oomol.dev/v1/wg-wikimedia/qids:resolve"),
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer api-key",
    );
  });

  it("preserves service error details and request identifiers", async () => {
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: "Wikimedia 414" },
          {
            headers: { "x-wg-request-id": "wikimedia-request-1" },
            status: 502,
          },
        ),
      ),
    );

    await expect(resolver.resolve([])).rejects.toMatchObject({
      detail: "Wikimedia 414",
      message:
        "wg-wikimedia 502: Wikimedia 414 (requestId=wikimedia-request-1)",
      name: "WikimediaServiceError",
      requestId: "wikimedia-request-1",
      status: 502,
    } satisfies Partial<WikimediaServiceError>);
  });
});
