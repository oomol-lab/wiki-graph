import { describe, expect, it, vi } from "vitest";

import { LocalWikimediaRequestGate } from "./local.js";

describe("LocalWikimediaRequestGate", () => {
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
