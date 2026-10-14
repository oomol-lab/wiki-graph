// Run with: pnpm exec tsx scripts/verify-library-upgrade.mjs /path/to/0.8.4-state
// The source is only read; each scenario creates a new, isolated copy.
import assert from "assert/strict";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join, resolve, relative } from "path";
import { createWikiGraphSDK } from "../packages/sdk/src/sdk.ts";
import { runWikiGraphCLICaptured } from "../packages/cli/src/app/runner.ts";
import {
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "../packages/sdk/src/node-platform.ts";
import { beginLibraryMembershipTransaction } from "../packages/core/src/library/membership-transaction.ts";
import {
  resolveWikiGraphLibrary,
  parseWikiGraphLibraryUri,
} from "../packages/core/src/library/registry.ts";
import { copyFileContent } from "../packages/core/src/runtime/platform/index.ts";
import { WikiGraphArchiveFile } from "../packages/core/src/storage/wikg/wiki-graph-archive-file.ts";

// A separate process leaves the durable transaction unfinished. The verifier
// then opens the copied state in a new process/runtime to exercise recovery.
if (process.argv[2] === "--interrupt-recovery") {
  const state = resolve(process.argv[3]);
  const sdk = createWikiGraphSDK({ stateDir: state, cwd: state });
  await sdk.run(async () => {
    const library = await resolveWikiGraphLibrary(
      parseWikiGraphLibraryUri("wikg://lib"),
    );
    const member = JSON.parse(
      sql(
        join(state, "core.sqlite"),
        "SELECT json_object('path',relative_path) FROM library_archives ORDER BY id LIMIT 1;",
      ),
    );
    const path = join(state, "default-library", member.path);
    const transaction = await beginLibraryMembershipTransaction(
      library.folder,
      library.staging,
      { kind: "migrate", targetPath: member.path },
    );
    await copyFileContent(
      new NodeFile(path),
      await transaction.createBackupFile(),
    );
    await rm(path);
    await mkdir(path);
    await writeFile(join(path, "partial"), "simulated process interruption");
  });
  sdk.close();
  process.exit(0);
}

const source = resolve(process.argv[2] ?? "/Users/taozeyu/.wikigraph");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sql(file, query) {
  return execFileSync("sqlite3", [file, query], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}
async function hashes(root, prefix = "") {
  const result = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    assert(!entry.isSymbolicLink(), "Source must not contain symlinks");
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(root, name));
    else result[name] = hash(await readFile(join(root, name)));
  }
  return result;
}
async function zipEntries(file) {
  const reader = await nodeWikiGraphPlatform.zip.open(new NodeFile(file));
  try {
    const entries = {};
    for (const name of await reader.listEntries()) {
      const bytes = await reader.readEntry(name);
      if (bytes !== undefined) entries[name] = bytes;
    }
    return entries;
  } finally {
    await reader.close();
  }
}
async function cli(stateDir, argv) {
  const result = await runWikiGraphCLICaptured({
    stateDir,
    cwd: stateDir,
    argv,
    env: {},
  });
  assert.equal(
    result.exitCode,
    0,
    `Command failed: ${argv.join(" ")}\n${result.stderr}`,
  );
  return argv.includes("--json") ? JSON.parse(result.stdout) : result.stdout;
}
function checkDatabase(file) {
  assert.equal(sql(file, "PRAGMA integrity_check;"), "ok");
  assert.equal(sql(file, "PRAGMA foreign_key_check;"), "");
  return hash(sql(file, ".dump"));
}
const original = await hashes(source);
const report = [];
try {
  for (const scenario of ["migration", "mixed", "recovery"]) {
    const root = await mkdtemp(join(tmpdir(), "wikigraph-upgrade-084-"));
    const state = join(root, "state");
    await cp(source, state, { recursive: true });
    const core = join(state, "core.sqlite");
    const libraries = JSON.parse(
      sql(
        core,
        "SELECT json_group_array(json_object('id',id,'identity',folder_identity)) FROM libraries;",
      ),
    );
    for (const library of libraries) {
      assert(library.identity.startsWith("node-directory:"));
      const path = Buffer.from(
        library.identity.slice("node-directory:".length),
        "base64url",
      ).toString();
      const suffix = relative(source, path);
      assert(
        !suffix.startsWith("..") && !suffix.startsWith("/"),
        "External library requires explicit isolation",
      );
      const identity = new NodeDirectory(join(state, suffix)).identity;
      sql(
        core,
        `UPDATE libraries SET folder_identity='${identity}' WHERE id=${Number(library.id)};`,
      );
    }
    // No generation or replay of copied queue/coordinator/cache state during auditing.
    for (const table of ["config_sections", "state_locks", "library_locks"]) {
      if (
        sql(
          core,
          `SELECT count(*) FROM sqlite_master WHERE name='${table}';`,
        ) === "1"
      ) {
        sql(core, `DELETE FROM ${table};`);
      }
    }
    for (const name of ["jobs", "cache", "tmp", "documents", "staging"]) {
      await rm(join(state, name), { force: true, recursive: true });
    }
    // The old Home must be explicitly upgraded before even baseline reads.
    // This affects only the fresh scenario copy, never the source sample.
    await cli(state, ["maintenance", "upgrade", "home", "--json"]);
    const members = JSON.parse(
      sql(
        core,
        "SELECT json_group_array(json_object('id',id,'publicId',public_id,'path',relative_path,'token',last_seen_mutation_token)) FROM library_archives;",
      ),
    );
    assert.equal(members.length, 4, "Expected four actual 0.8.4 ZIP members");
    assert.deepEqual(
      members.map((member) => member.publicId).sort(),
      ["f4f99c231f50", "f746290ba7bf", "65e5b7189f35", "9ed89ffbbcec"].sort(),
      "Unexpected acceptance sample archive IDs",
    );
    const baseline = new Map();
    for (const member of members) {
      const path = join(state, "default-library", member.path);
      assert((await stat(path)).isFile());
      const entries = await zipEntries(path);
      const db = join(root, `${member.publicId}.db`);
      await writeFile(db, entries["database.db"]);
      baseline.set(member.publicId, { entries, dump: checkDatabase(db) });
    }
    // Establish public graph/evidence baselines without scanning or converting ZIPs.
    const publicBaseline = new Map();
    const expectedCounts = {
      f4f99c231f50: { chunk: 9, entity: 17, triple: 14 },
      f746290ba7bf: { chunk: 52, entity: 12, triple: 11 },
    };
    for (const member of members.filter(
      (member) => expectedCounts[member.publicId],
    )) {
      const uri = `wikg://lib/arc/${member.publicId}`;
      const objects = {};
      for (const lens of ["chunk", "entity", "triple"]) {
        objects[lens] = await cli(state, [uri + "/" + lens, "--all", "--json"]);
        assert.equal(
          objects[lens].objects.length,
          expectedCounts[member.publicId][lens],
        );
        const first = objects[lens].objects[0];
        assert(first, "Expected nonempty generated graph");
        objects[lens + "Evidence"] = await cli(state, [
          uri + first.uri.slice("wikg:/".length),
          "evidence",
          "--all",
          "--json",
        ]);
      }
      publicBaseline.set(member.publicId, objects);
    }
    if (scenario === "mixed") {
      // The first invocation completes conversion; replace just one member with
      // its original ZIP to prove the next invocation handles mixed storage.
      await cli(state, ["maintenance", "upgrade", "wikg://lib", "--json"]);
      const member = members[0];
      await rm(join(state, "default-library", member.path), {
        recursive: true,
      });
      await cp(
        join(source, "default-library", member.path),
        join(state, "default-library", member.path),
      );
    }
    if (scenario === "recovery") {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("scripts/verify-library-upgrade.mjs"),
          "--interrupt-recovery",
          state,
        ],
        { stdio: "pipe" },
      );
    }
    const result = await cli(state, [
      "maintenance",
      "upgrade",
      "wikg://lib",
      "--json",
    ]);
    assert.equal(result.status, "upgraded");
    assert.equal(result.migrated.length, scenario === "mixed" ? 1 : 4);
    assert.deepEqual(result.unavailable, []);
    assert.equal(result.failed, undefined);
    for (const member of members) {
      const path = join(state, "default-library", member.path);
      assert((await stat(path)).isDirectory());
      const before = baseline.get(member.publicId);
      for (const [name, bytes] of Object.entries(before.entries)) {
        if (["database.db", "index.db", "fts.db"].includes(name)) continue;
        assert.equal(
          hash(await readFile(join(path, name))),
          hash(bytes),
          `Entry changed: ${member.path}/${name}`,
        );
      }
      assert.equal(
        checkDatabase(join(path, "database.db")),
        before.dump,
        "Main database contents changed",
      );
      const persisted = JSON.parse(
        sql(
          core,
          `SELECT json_object('publicId',public_id,'path',relative_path,'token',last_seen_mutation_token) FROM library_archives WHERE id=${Number(member.id)};`,
        ),
      );
      assert.deepEqual(persisted, {
        publicId: member.publicId,
        path: member.path,
        token: member.token,
      });
    }
    checkDatabase(core);
    for (const [id, objects] of publicBaseline) {
      const uri = `wikg://lib/arc/${id}`;
      for (const lens of ["chunk", "entity", "triple"]) {
        const after = await cli(state, [uri + "/" + lens, "--all", "--json"]);
        assert.deepEqual(after, objects[lens]);
        const first = after.objects[0];
        assert.deepEqual(
          await cli(state, [
            uri + first.uri.slice("wikg:/".length),
            "evidence",
            "--all",
            "--json",
          ]),
          objects[lens + "Evidence"],
        );
      }
      await cli(state, [uri + "/index", "sync"]);
      const query = id === "f4f99c231f50" ? "Robinson" : "OCR";
      const found = await cli(state, [
        uri + "/entity",
        "--query",
        query,
        "--query-mode",
        "fts",
        "--limit",
        "2",
        "--json",
      ]);
      assert(found.objects.length > 0);
    }
    await cli(state, ["wikg://lib/index", "sync"]);
    const repeat = await cli(state, [
      "maintenance",
      "upgrade",
      "wikg://lib",
      "--json",
    ]);
    assert.equal(repeat.status, "already-current");
    assert.equal(repeat.migrated.length, 0);
    const writablePath = join(
      state,
      "default-library",
      members.find((member) => member.publicId === "f4f99c231f50").path,
    );
    const writer = createWikiGraphSDK({ stateDir: state, cwd: state });
    try {
      await writer.run(async () => {
        await new WikiGraphArchiveFile(new NodeDirectory(writablePath)).write(
          async (document) => {
            const draft = await document.getSerialFragments(1).createDraft();
            draft.addSentence("Upgrade verifier persisted write.", 5);
            await draft.commit();
          },
        );
      });
    } finally {
      writer.close();
    }
    const reader = createWikiGraphSDK({ stateDir: state, cwd: state });
    try {
      await reader.run(async () => {
        await new WikiGraphArchiveFile(
          new NodeDirectory(writablePath),
        ).readDocument(async (document) => {
          assert(
            (await document.getSerialFragments(1).readText()).includes(
              "Upgrade verifier persisted write.",
            ),
          );
        });
      });
    } finally {
      reader.close();
    }
    checkDatabase(join(writablePath, "database.db"));
    report.push({
      scenario,
      root,
      migrated: result.migrated.length,
      databaseAndEntryIntegrity: true,
      graphAndEvidenceEquality: true,
      ftsQuery: true,
      idempotent: true,
      writeAndReopen: true,
    });
  }
} finally {
  assert.deepEqual(
    await hashes(source),
    original,
    "Original state was modified",
  );
}
console.log(JSON.stringify({ sourceUnchanged: true, report }, null, 2));
