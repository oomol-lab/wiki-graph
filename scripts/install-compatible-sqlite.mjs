// Isolated investigation only: download a published addon, never fall back to a compiler.
import assert from "assert/strict";
import { spawnSync } from "child_process";
import { appendFile, mkdtemp, readFile, writeFile } from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";

const specs = {
  "official-5": "sqlite3@5.1.7",
  "official-6": "sqlite3@6.0.1",
  "appthreat-7": "@appthreat/sqlite3@7.0.1",
  "appthreat-8": "@appthreat/sqlite3@8.0.2",
};
const variant = process.env.SQLITE_DIAGNOSTIC_VARIANT;
assert.ok(specs[variant], `Unknown diagnostic variant ${variant}`);
const root = await mkdtemp(join(tmpdir(), "sqlite-compatible-"));
await writeFile(join(root, "package.json"), JSON.stringify({ private: true }));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
  });
  assert.equal(result.status, 0, `${command} failed; no source-build fallback`);
}
run("npm", [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  specs[variant],
]);
const require = createRequire(join(root, "package.json"));
const name = variant.startsWith("official-") ? "sqlite3" : "@appthreat/sqlite3";
const modulePath = require.resolve(name);
const pkg = dirname(dirname(modulePath));
if (variant !== "appthreat-8") {
  // Explicit invocation cannot silently invoke node-gyp when a binary is missing.
  run(
    process.execPath,
    [require.resolve("prebuild-install/bin.js"), "-r", "napi", "--verbose"],
    pkg,
  );
}
const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
console.log(
  JSON.stringify({
    variant,
    spec: specs[variant],
    node: process.version,
    napi: process.versions.napi,
    engines: manifest.engines,
    modulePath,
  }),
);
if (process.env.GITHUB_ENV)
  await appendFile(
    process.env.GITHUB_ENV,
    `SQLITE_DIAGNOSTIC_MODULE=${modulePath}\nSQLITE_CANDIDATE_SPEC=${specs[variant]}\n`,
  );
