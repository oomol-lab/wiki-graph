// CI-only source-control/A-B build. Never used by product installation/release.
import assert from "assert/strict";
import { spawnSync } from "child_process";
import { appendFile, mkdtemp, readFile, writeFile } from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";

assert.equal(process.platform, "win32");
const patched = process.argv[2] === "patched";
const candidate = process.argv[2] === "candidate";
const root = await mkdtemp(join(tmpdir(), "sqlite-ab-"));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
  });
  assert.equal(result.status, 0, `${command} failed`);
}
await writeFile(join(root, "package.json"), JSON.stringify({ private: true }));
run("npm", [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  candidate ? "@appthreat/sqlite3@9.1.0" : "sqlite3@6.0.1",
  "node-gyp@13.1.0",
]);
const pkg = candidate
  ? join(root, "node_modules", "@appthreat", "sqlite3")
  : join(root, "node_modules", "sqlite3");
if (patched) {
  const tarball = join(pkg, "deps", "sqlite-autoconf-3520000.tar.gz");
  run("tar", ["-xzf", tarball, "-C", root]);
  const source = join(root, "sqlite-autoconf-3520000", "sqlite3.c");
  const text = await readFile(source, "utf8");
  const before = String.raw`static int winIsUNCPath(const char *zFile){
  if( zFile[0]=='\\' && zFile[1]=='\\' ){
    return 1;
  }
  return sqlite3_win_test_unc_locking;
}`;
  // Exact function from upstream SQLite version-3.54.0/src/os_win.c.
  const after = String.raw`static int winIsUNCPath(const char *zFile){
  if( zFile[0]=='\\' && zFile[1]=='\\' ){
    if( zFile[2]=='?'
     && zFile[3]=='\\'
     && sqlite3Isalpha(zFile[4])
     && zFile[5]==':'
     && winIsDirSep(zFile[6])
    ){
      return sqlite3_win_test_unc_locking;
    }else{
      return 1;
    }
  }
  return sqlite3_win_test_unc_locking;
}`;
  assert.equal(
    text.split(before).length,
    2,
    "Unexpected SQLite source; refuse partial/mismatched patch",
  );
  await writeFile(source, text.replace(before, after));
  run("tar", ["-czf", tarball, "-C", root, "sqlite-autoconf-3520000"]);
}
const require = createRequire(join(root, "package.json"));
if (!candidate)
  run(
    process.execPath,
    [
      require.resolve("node-gyp/bin/node-gyp.js"),
      "rebuild",
      "--napi_build_version=6",
    ],
    pkg,
  );
await appendFile(
  process.env.GITHUB_ENV,
  `SQLITE_DIAGNOSTIC_MODULE=${join(pkg, "lib", "sqlite3.js")}\n`,
);
