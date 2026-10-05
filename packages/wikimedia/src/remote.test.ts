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
          {
            code: "retry-budget-exhausted",
            detail: "upstream failed",
            retryable: true,
            retryAfterMs: 5_000,
            status: 503,
            type: "error",
          },
        ]),
      ),
    );
    const iterator = resolver
      .resolve([{ disambiguation: false, qid: "Q1" }])
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).rejects.toMatchObject({
      code: "retry-budget-exhausted",
      detail: "upstream failed",
      retryable: true,
      retryAfterMs: 5_000,
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

    await expect(
      collect(resolver.resolve([{ disambiguation: false, qid: "Q1" }])),
    ).rejects.toThrow("ended before the done event");
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
    const iterator = resolver
      .resolve([{ disambiguation: false, qid: "Q1" }])
      [Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses the service route for a root endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        streamResponse([
          { index: 0, resolution: resolution("Q1"), type: "resolution" },
          { type: "done" },
        ]),
      );
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );

    await collect(resolver.resolve([{ disambiguation: false, qid: "Q1" }]));

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
      .mockResolvedValue(
        streamResponse([
          { index: 0, resolution: resolution("Q1"), type: "resolution" },
          { type: "done" },
        ]),
      );
    const resolver = new HttpWikimediaResolver(
      "https://pdf-craft-api.oomol.dev/v1/wg-wikimedia/",
      "api-key",
      fetcher,
    );

    await collect(resolver.resolve([{ disambiguation: false, qid: "Q1" }]));

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

    await expect(
      collect(resolver.resolve([{ disambiguation: false, qid: "Q1" }])),
    ).rejects.toMatchObject({
      detail: "Wikimedia 414",
      message:
        "wg-wikimedia 502: Wikimedia 414 (requestId=wikimedia-request-1)",
      name: "WikimediaServiceError",
      requestId: "wikimedia-request-1",
      status: 502,
    } satisfies Partial<WikimediaServiceError>);
  });

  it("splits large inputs into service-sized requests and maps indexes globally", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const batch = requestEntities(init);
      return Promise.resolve(
        streamResponse([
          ...batch
            .map((item, index) => ({
              index,
              resolution: resolution(item.qid),
              type: "resolution" as const,
            }))
            .reverse(),
          { type: "done" },
        ]),
      );
    });
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );
    const input = Array.from({ length: 4_461 }, (_, index) => ({
      disambiguation: false,
      qid: `Q${index + 1}`,
    }));

    const result = await collect(resolver.resolve(input));

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(
      fetcher.mock.calls.map(([, init]) => requestEntities(init).length),
    ).toStrictEqual([1_000, 1_000, 1_000, 1_000, 461]);
    expect(result.map(({ index }) => index)).toStrictEqual([
      ...range(999, 0),
      ...range(1_999, 1_000),
      ...range(2_999, 2_000),
      ...range(3_999, 3_000),
      ...range(4_460, 4_000),
    ]);
  });

  it("does not request later batches after a batch fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(successfulBatchResponse(1_000))
      .mockResolvedValueOnce(
        streamResponse([
          { index: 0, resolution: resolution("Q1001"), type: "resolution" },
          { detail: "batch failed", status: 503, type: "error" },
        ]),
      );
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );

    await expect(
      collect(resolver.resolve(entities(2_001))),
    ).rejects.toMatchObject({ detail: "batch failed", status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a batch that completes without every result", async () => {
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamResponse([
            { index: 0, resolution: resolution("Q1"), type: "resolution" },
            { type: "done" },
          ]),
        ),
    );

    await expect(collect(resolver.resolve(entities(2)))).rejects.toThrow(
      "completed after 1 of 2 results",
    );
  });

  it("rejects duplicate and out-of-range batch indexes", async () => {
    const duplicate = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi.fn<typeof fetch>().mockResolvedValue(
        streamResponse([
          { index: 0, resolution: resolution("Q1"), type: "resolution" },
          { index: 0, resolution: resolution("Q1"), type: "resolution" },
        ]),
      ),
    );
    const outOfRange = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamResponse([
            { index: 2, resolution: resolution("Q3"), type: "resolution" },
          ]),
        ),
    );

    await expect(collect(duplicate.resolve(entities(2)))).rejects.toThrow(
      "input index 0 twice",
    );
    await expect(collect(outOfRange.resolve(entities(2)))).rejects.toThrow(
      "out-of-range input index 2",
    );
  });

  it("does not start a later batch after cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort(new Error("cancelled"));
      return Promise.resolve(successfulBatchResponse(1_000));
    });
    const resolver = new HttpWikimediaResolver(
      "https://service.example",
      "api-key",
      fetcher,
    );

    await expect(
      collect(resolver.resolve(entities(1_001), { signal: controller.signal })),
    ).rejects.toThrow("cancelled");
    expect(fetcher).toHaveBeenCalledOnce();
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

function entities(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    disambiguation: false,
    qid: `Q${index + 1}`,
  }));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: from - to + 1 }, (_, index) => from - index);
}

function successfulBatchResponse(count: number): Response {
  return streamResponse([
    ...entities(count).map((item, index) => ({
      index,
      resolution: resolution(item.qid),
      type: "resolution",
    })),
    { type: "done" },
  ]);
}

function requestEntities(
  init: RequestInit | undefined,
): readonly { readonly qid: string }[] {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  const body = JSON.parse(init.body) as {
    entities: readonly { readonly qid: string }[];
  };
  return body.entities;
}
