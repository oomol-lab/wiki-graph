// Replace only an ephemeral CI checkout's addon for binding qualification.
import assert from "assert/strict";
import { createHash } from "crypto";
import { copyFile, readFile, unlink } from "fs/promises";
import { createRequire } from "module";
import { dirname, join } from "path";

assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.ok(
  ["source-patched", "official-5", "appthreat-7"].includes(
    process.env.SQLITE_DIAGNOSTIC_VARIANT,
  ),
);
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
const originalSha256 = createHash("sha256")
  .update(await readFile(target))
  .digest("hex");
// pnpm may import files as hardlinks. Replace the directory entry rather than
// overwriting a shared inode, so the experiment cannot poison the package cache.
await unlink(target);
await copyFile(source, target);
console.log(
  JSON.stringify({
    source,
    target,
    originalSha256,
    sha256: createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
    warning:
      "Diagnostic addon only; not the published/product binding and not release acceptance",
  }),
);
