import { tmpdir } from "os";
import { join, resolve } from "path";

import { describe, expect, it } from "vitest";

import {
  getWikiGraphStateDirectoryPathForTesting,
  resolveWikiGraphHomeDirectoryPath,
  setWikiGraphStateDirectoryPathForTesting,
} from "./dir.js";

describe("wiki graph runtime directories", () => {
  it("keeps testing state directory overrides scoped to async chains", async () => {
    const originalStateDir = getWikiGraphStateDirectoryPathForTesting();
    const leftStateDir = join(tmpdir(), "wikigraph-state-left");
    const rightStateDir = join(tmpdir(), "wikigraph-state-right");

    try {
      const [left, right] = await Promise.all([
        readScopedHomeDirectory(leftStateDir, 10),
        readScopedHomeDirectory(rightStateDir, 0),
      ]);

      expect(left).toBe(resolve(leftStateDir));
      expect(right).toBe(resolve(rightStateDir));
    } finally {
      setWikiGraphStateDirectoryPathForTesting(originalStateDir);
    }
  });
});

async function readScopedHomeDirectory(
  stateDir: string,
  delayMs: number,
): Promise<string> {
  setWikiGraphStateDirectoryPathForTesting(stateDir);
  await new Promise((resolveDelay) => {
    setTimeout(resolveDelay, delayMs);
  });

  return resolveWikiGraphHomeDirectoryPath();
}
