import { readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { LLMCache } from "../../packages/core/src/external/llm/cache.js";
import { withTempDir } from "../helpers/temp.js";

describe("llm/cache", () => {
  it("creates, writes, and reads cache entries", async () => {
    await withTempDir("wikigraph-cache-", async (path) => {
      const cache = new LLMCache(path);
      const entry = cache.createEntry("alpha", "cached-response");

      await cache.write(entry);

      expect(await cache.read("alpha")).toBe("cached-response");
      expect(await readFile(`${path}/alpha.txt`, "utf8")).toBe(
        "cached-response",
      );
    });
  });

  it("returns undefined for missing cache entries", async () => {
    await withTempDir("wikigraph-cache-", async (path) => {
      const cache = new LLMCache(path);

      await expect(cache.read("missing")).resolves.toBeUndefined();
    });
  });
});
