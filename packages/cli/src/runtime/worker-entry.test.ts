import { describe, expect, it } from "vitest";

import { withWorkerEntryRuntime } from "./worker-entry.js";
import { getCLIEnvPolicy } from "./context.js";

describe("runtime/worker-entry", () => {
  it("rejects direct worker entry execution without the internal flag", async () => {
    await withProcessArgv(["node", "queue-worker.js"], async () => {
      await expect(
        withWorkerEntryRuntime("queue-worker", () => undefined),
      ).rejects.toThrow("This Wiki Graph worker entry is internal.");
    });
  });

  it("strips internal worker arguments before running the worker", async () => {
    await withProcessArgv(
      [
        "node",
        "queue-worker.js",
        "--wikigraph-internal-child",
        "queue-worker",
        "--wikigraph-state-dir",
        "/tmp/wiki-graph-state",
        "--wikigraph-env-policy",
        "development",
        "--wikigraph-dev-project-root",
        "/repo",
        "--flag",
      ],
      async () => {
        await expect(
          withWorkerEntryRuntime("queue-worker", (args) => {
            expect(args.argv).toStrictEqual(["--flag"]);
            expect(args.devProjectRoot).toBe("/repo");
            expect(args.envPolicy).toBe("development");
            expect(args.stateDir).toBe("/tmp/wiki-graph-state");
            expect(getCLIEnvPolicy()).toBe("development");
          }),
        ).resolves.toBeUndefined();
      },
    );
  });
});

async function withProcessArgv(
  argv: string[],
  operation: () => Promise<void>,
): Promise<void> {
  const originalArgv = process.argv;

  try {
    process.argv = argv;
    await operation();
  } finally {
    process.argv = originalArgv;
  }
}
