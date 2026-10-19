import { spawnSync } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers/temp.js";

const files = [
  "node-platform.test.ts",
  "opaque-file-adapter.test.ts",
  "wiki-graph-archive-file.test.ts",
  "archive-coordination.test.ts",
  "settlement-coordination.test.ts",
  "delivery.full-regression.test.ts",
  "sdk-workflow.test.ts",
  "wal-recovery.test.ts",
  "path-contract.test.ts",
];

describe("Windows acceptance report gate", () => {
  it.each(["passed", "skipped", "empty", "missing", "failed"])(
    "accepts only fully executed reports (%s)",
    async (scenario) => {
      await withTempDir("wg-gate-", async (root) => {
        const testResults = files.map((name) => ({
          name: `C:\\tests\\${name}`,
          assertionResults: [{ status: "passed" }],
        }));
        if (scenario === "skipped")
          testResults[0]!.assertionResults[0]!.status = "pending";
        if (scenario === "empty") testResults[0]!.assertionResults = [];
        if (scenario === "missing") testResults.pop();
        if (scenario === "failed")
          testResults[0]!.assertionResults[0]!.status = "failed";
        const report = join(root, "report.json");
        await writeFile(
          report,
          JSON.stringify({
            success: true,
            numPassedTests: files.length,
            numPendingTests: 0,
            numTodoTests: 0,
            testResults,
          }),
        );
        const result = spawnSync(
          process.execPath,
          ["scripts/check-windows-regressions.mjs", "--check-report", report],
          { encoding: "utf8" },
        );
        if (scenario === "passed") expect(result.status, result.stderr).toBe(0);
        else {
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Windows acceptance");
        }
      });
    },
  );
});
