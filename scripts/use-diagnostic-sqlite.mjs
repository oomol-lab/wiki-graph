// Replace only an ephemeral CI checkout's addon for the patched acceptance experiment.
import assert from "assert/strict";
import { createHash } from "crypto";
import { copyFile, readFile } from "fs/promises";
import { createRequire } from "module";
import { dirname, join } from "path";

assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.SQLITE_DIAGNOSTIC_VARIANT, "source-patched");
assert.ok(process.env.SQLITE_DIAGNOSTIC_MODULE);
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const source = join(
  dirname(process.env.SQLITE_DIAGNOSTIC_MODULE),
  "..",
  "build",
  "Release",
  "node_sqlite3.node",
);
const target = join(
  dirname(require.resolve("sqlite3")),
  "..",
  "build",
  "Release",
  "node_sqlite3.node",
);
await copyFile(source, target);
console.log(
  JSON.stringify({
    source,
    target,
    sha256: createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
    warning:
      "Diagnostic patched addon only; not the published/product binding and not release acceptance",
  }),
);
