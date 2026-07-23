import { join } from "path";
import { describe, expect, it } from "vitest";

import { createInternalChildCommandForTesting } from "./internal-child.js";

describe("runtime/internal-child", () => {
  it("uses dev worker entries when WIKIGRAPH_DEV is set", () => {
    const previous = process.env.WIKIGRAPH_DEV;

    try {
      process.env.WIKIGRAPH_DEV = join("/repo", ".wikigraph", "state");

      expect(
        createInternalChildCommandForTesting("queue-worker", ["--flag"]),
      ).toStrictEqual({
        args: [
          join("/repo", "node_modules", "tsx", "dist", "cli.mjs"),
          join("/repo", "packages", "cli", "src", "bin", "dev-queue-worker.ts"),
          "--flag",
        ],
        command: process.execPath,
      });
      expect(createInternalChildCommandForTesting("gc-worker").args[1]).toBe(
        join("/repo", "packages", "cli", "src", "bin", "dev-gc-worker.ts"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.WIKIGRAPH_DEV;
      } else {
        process.env.WIKIGRAPH_DEV = previous;
      }
    }
  });

  it("uses production worker entries when WIKIGRAPH_DEV is unset", () => {
    const previous = process.env.WIKIGRAPH_DEV;

    try {
      delete process.env.WIKIGRAPH_DEV;

      expect(createInternalChildCommandForTesting("queue-worker").args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "queue-worker.js"),
      );
      expect(createInternalChildCommandForTesting("gc-worker").args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "gc-worker.js"),
      );
    } finally {
      if (previous !== undefined) {
        process.env.WIKIGRAPH_DEV = previous;
      }
    }
  });
});
