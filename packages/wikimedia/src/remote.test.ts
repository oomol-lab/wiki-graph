import { describe, expect, it, vi } from "vitest";

import type { WikimediaServiceError } from "./remote.js";
import { HttpWikimediaResolver } from "./remote.js";

describe("HttpWikimediaResolver", () => {
  it("yields the first resolution before the response completes", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
    );
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    const iterator = resolver
      .resolve([{ disambiguation: false, qid: "Q1" }])
      [Symbol.asyncIterator]();
    const first = iterator.next();

    streamController.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({ index: 0, resolution: resolution("Q1"), type: "resolution" })}\n`,
      ),
    );

    await expect(first).resolves.toStrictEqual({
      done: false,
      value: { index: 0, resolution: resolution("Q1") },
    });
    streamController.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({ type: "heartbeat" })}\n${JSON.stringify({ type: "done" })}\n`,
      ),
    );
    streamController.close();
    await expect(iterator.next()).resolves.toStrictEqual({
      done: true,
      value: undefined,
    });
  });

  it("fails after partial results when the stream reports an error", async () => {
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi.fn<typeof fetch>().mockResolvedValue(
        streamResponse([
          { index: 0, resolution: resolution("Q1"), type: "resolution" },
          { detail: "upstream failed", status: 503, type: "error" },
        ]),
      ),
    );
    const iterator = resolver.resolve([])[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).rejects.toMatchObject({
      detail: "upstream failed",
      status: 503,
    });
  });

  it("rejects a stream that closes without a terminal event", async () => {
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamResponse([
            { index: 0, resolution: resolution("Q1"), type: "resolution" },
          ]),
        ),
    );

    await expect(collect(resolver.resolve([]))).rejects.toThrow(
      "ended before the done event",
    );
  });

  it("cancels the response body when the consumer stops early", async () => {
    const cancel = vi.fn();
    let delivered = false;
    const body = {
      getReader: () => ({
        cancel,
        read: () => {
          if (delivered) return new Promise<never>(() => undefined);
          delivered = true;
          return Promise.resolve({
            done: false as const,
            value: new TextEncoder().encode(
              `${JSON.stringify({ index: 0, resolution: resolution("Q1"), type: "resolution" })}\n`,
            ),
          });
        },
        releaseLock: vi.fn(),
      }),
    };
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi.fn<typeof fetch>().mockResolvedValue({
        body,
        headers: new Headers(),
        ok: true,
        status: 200,
      } as unknown as Response),
    );
    const iterator = resolver.resolve([])[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses the service route for a root endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(streamResponse([{ type: "done" }]));
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );

    await collect(resolver.resolve([]));

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
      .mockResolvedValue(streamResponse([{ type: "done" }]));
    const resolver = new HttpWikimediaResolver(
      "https://pdf-craft-api.oomol.dev/v1/wg-wikimedia/",
      "api-key",
      fetcher,
    );

    await collect(resolver.resolve([]));

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

    await expect(collect(resolver.resolve([]))).rejects.toMatchObject({
      detail: "Wikimedia 414",
      message:
        "wg-wikimedia 502: Wikimedia 414 (requestId=wikimedia-request-1)",
      name: "WikimediaServiceError",
      requestId: "wikimedia-request-1",
      status: 502,
    } satisfies Partial<WikimediaServiceError>);
  });
});

function streamResponse(events: readonly unknown[]): Response {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
    headers: { "content-type": "application/x-ndjson" },
  });
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function resolution(qid: string) {
  return {
    en: { description: null, label: qid, url: null },
    qid,
    zh: { description: null, label: qid, url: null },
  };
}
