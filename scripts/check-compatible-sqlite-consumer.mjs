// Packed consumer qualification; product mode never overrides SQLite dependencies.
import assert from "assert/strict";
import { spawnSync } from "child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

const spec = process.env.SQLITE_CANDIDATE_SPEC;
const product = process.env.SQLITE_CONSUMER_PRODUCT === "true";
const repo = resolve(import.meta.dirname, "..");
const root =
  process.env.SQLITE_CONSUMER_ROOT ||
  (await mkdtemp(join(tmpdir(), "wg-sqlite-consumer-")));
const artifacts = resolve("test/.reports/sqlite-consumer.json");
const report = {
  commit: process.env.GITHUB_SHA,
  spec,
  product,
  node: process.version,
  root,
  cases: [],
};
function run(command, args, cwd = root, env = process.env, timeout = 600_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: process.platform === "win32" && ["npm", "pnpm"].includes(command),
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed: ${result.error || ""}\n${(result.stderr || "").slice(-8192)}`,
  );
  return result.stdout;
}
if (process.argv[2] === "--pack") {
  const overrides = {};
  let sdkTarball;
  for (const name of ["job", "wikimedia", "core", "sdk"]) {
    const packed = JSON.parse(
      run(
        "pnpm",
        ["pack", "--json", "--pack-destination", root],
        join(repo, "packages", name),
      ),
    );
    const tar = (Array.isArray(packed) ? packed[0] : packed).filename;
    const file = resolve(root, tar);
    if (name === "sdk") sdkTarball = file;
    else overrides[`wiki-graph-${name}`] = `file:${file}`;
  }
  await writeFile(
    join(root, "packed.json"),
    JSON.stringify({ overrides, sdkTarball }),
  );
  await appendFile(process.env.GITHUB_ENV, `SQLITE_CONSUMER_ROOT=${root}\n`);
  process.exit(0);
}
assert.ok(
  product || ["sqlite3@5.1.7", "@appthreat/sqlite3@7.0.1"].includes(spec),
);
try {
  const { overrides, sdkTarball } = JSON.parse(
    await readFile(join(root, "packed.json"), "utf8"),
  );
  // Product acceptance must install the tarball's actual dependency, without
  // substituting a diagnostic binding through npm overrides or addon injection.
  if (!product)
    overrides.sqlite3 = spec.startsWith("sqlite3@")
      ? spec.slice(8)
      : `npm:${spec}`;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, overrides }),
  );
  // No lifecycle scripts: neither the candidate nor transitive packages may invoke a compiler.
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    sdkTarball,
    "electron@35.0.0",
  ]);
  const require = createRequire(join(root, "package.json"));
  const sqliteRoot = dirname(dirname(require.resolve("sqlite3")));
  const binding = JSON.parse(
    await readFile(join(sqliteRoot, "package.json"), "utf8"),
  );
  report.binding = { name: binding.name, version: binding.version };
  if (product) {
    assert.equal(binding.name, "@appthreat/sqlite3");
    assert.equal(binding.version, "7.0.1");
    const sdk = JSON.parse(
      await readFile(
        join(root, "node_modules/wiki-graph-sdk/package.json"),
        "utf8",
      ),
    );
    assert.equal(sdk.dependencies.sqlite3, "npm:@appthreat/sqlite3@7.0.1");
  }
  run(
    process.execPath,
    [require.resolve("prebuild-install/bin.js"), "-r", "napi", "--verbose"],
    sqliteRoot,
  );
  run(process.execPath, [join(root, "node_modules", "electron", "install.js")]);
  const electron = require("electron");
  const fixture = join(root, "consumer.cjs");
  await copyFile(
    join(repo, "test", "windows", "fixtures", "sqlite-consumer.cjs"),
    fixture,
  );
  // Optional diagnostic compares the workspace binding with the installed one.
  // Historical 515397c reports used SQLite 3.52 here; never assume the workspace
  // still uses that engine after the approved product dependency switch.
  if (!product) {
    const previous = join(root, "from-current-sqlite");
    await mkdir(previous);
    run(
      process.execPath,
      [fixture, "cjs", "create", previous],
      root,
      {
        ...process.env,
        SQLITE_CONSUMER_BASELINE_ROOT: join(repo, "packages", "sdk"),
      },
      120_000,
    );
    for (const mode of ["reopen", "append", "reopen"]) {
      try {
        const output = run(
          process.execPath,
          [fixture, "cjs", mode, previous],
          root,
          process.env,
          120_000,
        );
        report.cases.push({
          runtime: "node-from-workspace-binding",
          entry: "cjs",
          mode,
          passed: true,
          output,
        });
      } catch (error) {
        report.cases.push({
          runtime: "node-from-workspace-binding",
          entry: "cjs",
          mode,
          passed: false,
          error: String(error),
        });
      }
    }
  }
  for (const [runtime, executable, env] of [
    ["node", process.execPath, process.env],
    [
      "electron-35-run-as-node",
      electron,
      { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    ],
  ]) {
    for (const entry of ["cjs", "esm"]) {
      const data = join(root, `${runtime}-${entry}`);
      await mkdir(data);
      for (const mode of ["create", "reopen"]) {
        try {
          const output = run(
            executable,
            [fixture, entry, mode, data],
            root,
            env,
            120_000,
          );
          report.cases.push({ runtime, entry, mode, passed: true, output });
        } catch (error) {
          report.cases.push({
            runtime,
            entry,
            mode,
            passed: false,
            error: String(error),
          });
        }
      }
    }
  }
  assert.equal(
    report.cases.filter((result) => !result.passed).length,
    0,
    "Candidate qualification failed; all independent runtime/entry cases were retained",
  );
} finally {
  await mkdir(dirname(artifacts), { recursive: true });
  await writeFile(artifacts, JSON.stringify(report, null, 2));
}
