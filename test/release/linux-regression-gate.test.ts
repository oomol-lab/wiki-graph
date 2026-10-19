import { spawnSync } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers/temp.js";

describe("Linux workflow acceptance report", () => {
  it.each([
    "passed",
    "skipped",
    "missing-file",
    "missing-isolation-case",
    "failed",
  ])(
    "requires both workflows and the previously failing assertions (%s)",
    async (scenario) => {
      await withTempDir("wg-linux-gate-", async (root) => {
        const suites = [
          {
            name: "/test/library-search-pagination.full-regression.test.ts",
            assertionResults: [
              {
                title:
                  "isolates a stalled wikipage from standalone search, reads and writes",
                status: "passed",
              },
              {
                title:
                  "isolates a stalled wikipage from library search, reads and writes",
                status: "passed",
              },
            ],
          },
          {
            name: "/test/source-ingestion.full-regression.test.ts",
            assertionResults: [
              {
                title: "creates an EPUB archive with native import provenance",
                status: "passed",
              },
            ],
          },
        ];
        if (scenario === "skipped")
          suites[0]!.assertionResults[0]!.status = "pending";
        if (scenario === "failed")
          suites[0]!.assertionResults[0]!.status = "failed";
        if (scenario === "missing-file") suites.pop();
        if (scenario === "missing-isolation-case")
          suites[0]!.assertionResults.pop();
        const report = join(root, "report.json");
        await writeFile(
          report,
          JSON.stringify({
            success: true,
            numPassedTests: 3,
            numPendingTests: 0,
            numTodoTests: 0,
            testResults: suites,
          }),
        );
        const result = spawnSync(
          process.execPath,
          ["scripts/check-linux-regressions.mjs", "--check-report", report],
          { encoding: "utf8" },
        );
        if (scenario === "passed") expect(result.status, result.stderr).toBe(0);
        else {
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Linux workflow acceptance");
        }
      });
    },
  );
});
