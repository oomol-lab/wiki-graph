import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  withWikiGraphCLIRuntimeContext,
  type WikiGraphCLIRuntimeContext,
} from "./context.js";
import {
  createInternalChildCommandForTesting,
  createInternalChildEnvironmentForTesting,
} from "./internal-child.js";

describe("runtime/internal-child", () => {
  it("uses source worker entries from the development runtime context", async () => {
    await withRuntimeContext(
      {
        devProjectRoot: "/repo",
        envPolicy: "development",
        stateDir: join("/repo", ".wikigraph", "state"),
      },
      () => {
        expect(
          createInternalChildCommandForTesting("queue-worker", ["--flag"]),
        ).toStrictEqual({
          args: [
            join("/repo", "node_modules", "tsx", "dist", "cli.mjs"),
            join("/repo", "packages", "cli", "src", "bin", "queue-worker.ts"),
            "--wikigraph-internal-child",
            "queue-worker",
            "--wikigraph-state-dir",
            join("/repo", ".wikigraph", "state"),
            "--wikigraph-env-policy",
            "development",
            "--wikigraph-dev-project-root",
            "/repo",
            "--flag",
          ],
          command: process.execPath,
        });
        expect(createInternalChildCommandForTesting("gc-worker").args[1]).toBe(
          join("/repo", "packages", "cli", "src", "bin", "gc-worker.ts"),
        );
      },
    );
  });

  it("uses production worker entries when no development project root is set", async () => {
    await withRuntimeContext({}, () => {
      const queueCommand = createInternalChildCommandForTesting("queue-worker");
      expect(queueCommand.args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "queue-worker.js"),
      );
      expect(queueCommand.args.slice(1)).toStrictEqual([
        "--wikigraph-internal-child",
        "queue-worker",
      ]);
      expect(createInternalChildCommandForTesting("gc-worker").args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "gc-worker.js"),
      );
    });
  });

  it("does not pass parent runtime override env to internal children", async () => {
    await withRuntimeContext(
      {
        env: {
          ...process.env,
          WIKIGRAPH_DEV: "/tmp/dev-state",
          WIKIGRAPH_ENV_POLICY: "development",
          WIKIGRAPH_QUEUE_DISABLE_AUTOSTART: "1",
          WIKIGRAPH_STATE_DIR: "/tmp/state",
          WIKIGRAPH_TEST_VALUE: "kept",
        },
      },
      () => {
        const environment = createInternalChildEnvironmentForTesting();

        expect(environment.WIKIGRAPH_TEST_VALUE).toBe("kept");
        expect(environment.WIKIGRAPH_DEV).toBeUndefined();
        expect(environment.WIKIGRAPH_ENV_POLICY).toBeUndefined();
        expect(environment.WIKIGRAPH_QUEUE_DISABLE_AUTOSTART).toBeUndefined();
        expect(environment.WIKIGRAPH_STATE_DIR).toBeUndefined();
      },
    );
  });
});

async function withRuntimeContext(
  overrides: Partial<WikiGraphCLIRuntimeContext>,
  operation: () => void,
): Promise<void> {
  await withWikiGraphCLIRuntimeContext(
    {
      argv: [],
      cwd: process.cwd(),
      env: process.env,
      envPolicy: "production",
      exitCode: 0,
      queueAutostart: true,
      stderr: process.stderr,
      stdin: process.stdin,
      stdout: process.stdout,
      ...overrides,
    },
    operation,
  );
}
