import { describe, expect, it, vi } from "vitest";

import { LocalWikimediaRequestGate } from "./local.js";
import { MediaWikiClient } from "wiki-graph-wikimedia";

describe("LocalWikimediaRequestGate", () => {
  it("admits queued requests after an upstream request times out", async () => {
    const gate = new LocalWikimediaRequestGate({
      concurrency: 1,
      intervalMs: 0,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue(Response.json({ entities: {} }));
    const client = new MediaWikiClient(fetcher, undefined, gate, {
      timeoutMs: 100,
      retryWaitBudgetMs: 0,
    });
    const first = client.entities(["Q1"]).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const second = client.entities(["Q2"]);
    expect(await first).toMatchObject({
      code: "retry-budget-exhausted",
      cause: { code: "WIKIMEDIA_TIMEOUT" },
    });
    await expect(second).resolves.toHaveLength(1);
  });
  it("removes an aborted request from the pending queue", async () => {
    const gate = new LocalWikimediaRequestGate({
      concurrency: 1,
      intervalMs: 0,
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = gate.use(async () => await held);
    const operation = vi.fn(() => Promise.resolve());
    const controller = new AbortController();
    const queued = gate.use(operation, { signal: controller.signal });
    controller.abort(new Error("cancelled"));

    await expect(queued).rejects.toThrow("cancelled");
    expect(operation).not.toHaveBeenCalled();
    release();
    await first;
  });

  it("reserves capacity before admitting another request", async () => {
    const gate = new LocalWikimediaRequestGate({
      concurrency: 2,
      intervalMs: 0,
    });
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operations = Array.from(
      { length: 5 },
      async () =>
        await gate.use(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await held;
          active -= 1;
        }),
    );

    await vi.waitFor(() => expect(active).toBe(2));
    release?.();
    await Promise.all(operations);

    expect(maximum).toBe(2);
  });
});
