import { describe, expect, it, vi } from "vitest";

import { LocalWikimediaRequestGate } from "./local.js";

describe("LocalWikimediaRequestGate", () => {
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
