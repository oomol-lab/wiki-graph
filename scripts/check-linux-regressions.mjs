import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const checkOnly = process.argv[2] === "--check-report";
if (!checkOnly && process.platform !== "linux")
  throw new Error("Linux workflow acceptance must run on Linux");
const report = resolve(
  checkOnly ? process.argv[3] : "test/.reports/linux-workflows.json",
);
if (!checkOnly) {
  mkdirSync(resolve("test/.reports"), { recursive: true });
  rmSync(report, { force: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.linux-workflows.config.ts",
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${report}`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, WIKIGRAPH_REGRESSION_TRACE: "1" },
    },
  );
}
const result = JSON.parse(readFileSync(report, "utf8"));
for (const [filename, required] of [
  [
    "library-search-pagination.full-regression.test.ts",
    [
      "isolates a stalled wikipage from standalone search, reads and writes",
      "isolates a stalled wikipage from library search, reads and writes",
    ],
  ],
  [
    "source-ingestion.full-regression.test.ts",
    ["creates an EPUB archive with native import provenance"],
  ],
]) {
  const suite = result.testResults.find((suite) =>
    suite.name.replaceAll("\\", "/").endsWith(`/${filename}`),
  );
  if (
    !suite ||
    suite.assertionResults.length === 0 ||
    suite.assertionResults.some((test) => test.status !== "passed") ||
    required.some(
      (name) =>
        !suite.assertionResults.some(
          (test) => test.title === name && test.status === "passed",
        ),
    )
  )
    throw new Error(
      `Linux workflow acceptance omitted, skipped or failed ${filename}`,
    );
}
if (
  result.success !== true ||
  result.numPendingTests !== 0 ||
  result.numTodoTests !== 0
)
  throw new Error(
    "Linux workflow acceptance must pass without skips or todo cases",
  );
console.log(
  `Linux workflows: ${result.numPassedTests} passed; 0 skipped. Report: ${report}`,
);
