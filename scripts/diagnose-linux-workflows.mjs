// Compare identical test fixtures against pre-#784 and current product code.
// This is an opt-in investigation, never a substitute for product acceptance.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "linux")
  throw new Error("Run this comparison on Linux");
const repo = process.cwd();
const root = mkdtempSync(join(tmpdir(), "wg-linux-comparison-"));
const report = resolve("test/.reports/linux-comparison");
mkdirSync(report, { recursive: true });
const fixtures = [
  "packages/sdk/src/full-regression/library-search-pagination.full-regression.test.ts",
  "test/full-regression/cli/archive/source-ingestion.full-regression.test.ts",
  "test/helpers/regression-phase.ts",
  "test/helpers/regression-lifecycle.ts",
];
const bindingRoot = join(root, "official");
mkdirSync(bindingRoot);
execFileSync(
  "npm",
  [
    "install",
    "--prefix",
    bindingRoot,
    "--no-audit",
    "--no-fund",
    "sqlite3@6.0.1",
  ],
  { stdio: "inherit" },
);
const official = join(bindingRoot, "node_modules/sqlite3/lib/sqlite3.js");
for (const variant of [
  "baseline-official",
  "current-official",
  "current-product",
]) {
  const checkout = join(root, variant);
  mkdirSync(checkout);
  const archive = join(root, `${variant}.tar`);
  execFileSync("git", [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    variant.startsWith("baseline")
      ? "5ca523842b0aea8ef11fe7fed0308e593427baa5"
      : "HEAD",
  ]);
  execFileSync("tar", ["-xf", archive, "-C", checkout]);
  for (const fixture of fixtures)
    copyFileSync(join(repo, fixture), join(checkout, fixture));
  for (const parent of [
    "",
    "packages/sdk",
    "packages/cli",
    "packages/core",
    "packages/job",
    "packages/wikimedia",
  ])
    symlinkSync(
      join(repo, parent, "node_modules"),
      join(checkout, parent, "node_modules"),
      "dir",
    );
  writeFileSync(
    join(checkout, "diagnostic.config.ts"),
    `
import base from './vitest.config.ts';
export default { ...base, resolve: { ...base.resolve, alias: [
${variant.endsWith("official") ? `{find: /^sqlite3(?:\\/lib\\/sqlite3\\.js)?$/, replacement: ${JSON.stringify(official)}},` : ""}
...base.resolve.alias ] } };
`,
  );
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      join(repo, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "diagnostic.config.ts",
      ...fixtures.slice(0, 2),
      "--testNamePattern=isolates a stalled wikipage|creates an EPUB archive",
      "--reporter=verbose",
    ],
    {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, WIKIGRAPH_REGRESSION_TRACE: "1" },
      timeout: 10 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(join(report, `${variant}.log`), log);
  console.log(
    `${variant}: exit=${result.status}, duration=${Date.now() - started}ms\n${log}`,
  );
  // Known-failing controls must not suppress the remaining comparisons.
}
