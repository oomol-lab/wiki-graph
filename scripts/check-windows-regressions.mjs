import { readFileSync, mkdirSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { resolve } from "path";

const validateOnly = process.argv[2] === "--check-report";
if (!validateOnly && process.platform !== "win32") {
  throw new Error(
    "Windows acceptance must run on Windows, not a simulated platform.",
  );
}
const report = resolve(
  validateOnly ? process.argv[3] : "test/.reports/windows-regressions.json",
);
if (!validateOnly) {
  mkdirSync(resolve("test/.reports"), { recursive: true });
  rmSync(report, { force: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.windows.config.ts",
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${report}`,
    ],
    { stdio: "inherit" },
  );
}
const result = JSON.parse(readFileSync(report, "utf8"));
const required = [
  "node-platform.test.ts",
  "opaque-file-adapter.test.ts",
  "wiki-graph-archive-file.test.ts",
  "archive-coordination.test.ts",
  "delivery.full-regression.test.ts",
  "sdk-workflow.test.ts",
  "wal-recovery.test.ts",
  "path-contract.test.ts",
];
for (const filename of required) {
  const suite = result.testResults.find((suite) =>
    suite.name.replaceAll("\\", "/").endsWith(`/${filename}`),
  );
  if (
    !suite ||
    suite.assertionResults.length === 0 ||
    suite.assertionResults.some((test) => test.status !== "passed")
  ) {
    throw new Error(
      `Windows acceptance omitted, skipped or failed tests in ${filename}`,
    );
  }
}
if (
  result.success !== true ||
  result.numPassedTests <= 0 ||
  result.numPendingTests !== 0 ||
  result.numTodoTests !== 0 ||
  result.testResults.some((suite) =>
    suite.assertionResults.some((test) => test.status !== "passed"),
  )
) {
  throw new Error("Windows acceptance must pass without skipped or todo cases");
}
console.log(
  `Windows acceptance: ${result.numPassedTests} passed; ${result.numPendingTests} skipped. Report: ${report}`,
);
