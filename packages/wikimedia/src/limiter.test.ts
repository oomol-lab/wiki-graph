import { afterEach, describe, expect, it, vi } from "vitest";

import { ClusterLimiter } from "./limiter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClusterLimiter", () => {
  it("does not read a statistics bucket until five seconds after it ends", async () => {
    vi.spyOn(Date, "now").mockReturnValue(40_000);
    const reads: string[] = [];
    const values = new Map<string, string>();
    const redis = {
      decr(key: string) {
        const value = Number(values.get(key) ?? 0) - 1;
        values.set(key, String(value));
        return Promise.resolve(value);
      },
      eval() {
        return Promise.resolve(1);
      },
      async expire() {},
      get(key: string) {
        return Promise.resolve(values.get(key) ?? null);
      },
      hGetAll(key: string) {
        reads.push(key);
        return Promise.resolve(
          key === "wg-wikimedia:stats:2"
            ? { "instance:maxlag": "1", "instance:requests": "1" }
            : {},
        );
      },
      incr(key: string) {
        const value = Number(values.get(key) ?? 0) + 1;
        values.set(key, String(value));
        return Promise.resolve(value);
      },
      set(key: string, value: string, options?: { NX?: boolean }) {
        if (options?.NX === true && values.has(key)) {
          return Promise.resolve(null);
        }
        values.set(key, value);
        return Promise.resolve("OK");
      },
    };

    const release = await new ClusterLimiter(redis as never).acquire();
    await release();

    expect(reads).toStrictEqual(["wg-wikimedia:stats:1"]);
  });
});
