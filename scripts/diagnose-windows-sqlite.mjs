// Standalone native-binding experiment: deliberately imports no Wiki Graph code.
import assert from "assert/strict";
import { fork } from "child_process";
import { createHash } from "crypto";
import { once } from "events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join, resolve, toNamespacedPath } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const script = fileURLToPath(import.meta.url);
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const modulePath =
  process.env.SQLITE_DIAGNOSTIC_MODULE || require.resolve("sqlite3");
const imported = require(modulePath);
const sqlite = imported.default || imported;
const rounds = Number(process.env.SQLITE_DIAGNOSTIC_ROUNDS || 25);
const uriLongPath = process.env.SQLITE_DIAGNOSTIC_URI_LONGPATH === "true";
function sqliteFilename(filename) {
  if (!uriLongPath || filename === ":memory:") return filename;
  // Isolated VFS hypothesis: let SQLite's own long-path VFS accept a local
  // drive URI without confusing the caller's extended-drive prefix with UNC.
  // Real UNC is deliberately not rewritten or claimed supported by this probe.
  const local = /^\\\\\?\\[a-z]:\\/iu.test(filename)
    ? filename.slice(4)
    : filename;
  assert.match(local, /^[a-z]:\\/iu);
  const uri = pathToFileURL(local);
  uri.searchParams.set("vfs", "win32-longpath");
  return uri.href;
}
const call = (db, method, ...args) =>
  new Promise((resolve, reject) => {
    db[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    );
  });
const open = (filename, flags) =>
  new Promise((resolve, reject) => {
    const db = new sqlite.Database(
      sqliteFilename(filename),
      flags | sqlite.OPEN_FULLMUTEX | (uriLongPath ? sqlite.OPEN_URI : 0),
      (error) => {
        if (error) reject(error);
        else resolve(db);
      },
    );
  });
const serializeError = (error) => ({
  message: error.message,
  code: error.code,
  stack: error.stack,
});

async function read(filename) {
  const db = await open(filename, sqlite.OPEN_READONLY);
  try {
    assert.deepEqual(await call(db, "get", "SELECT value FROM marker"), {
      value: 42,
    });
    assert.deepEqual(await call(db, "get", "PRAGMA journal_mode"), {
      journal_mode: "wal",
    });
  } finally {
    await call(db, "close");
  }
}

async function probeCapabilities() {
  const db = await open(":memory:", sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
  try {
    await call(
      db,
      "exec",
      "CREATE VIRTUAL TABLE texts USING fts5(content); INSERT INTO texts VALUES('needle'); CREATE TABLE data(value BLOB)",
    );
    assert.deepEqual(
      await call(db, "get", "SELECT content FROM texts WHERE texts MATCH ?", [
        "needle",
      ]),
      { content: "needle" },
    );
    await call(db, "run", "INSERT INTO data VALUES(?)", [
      Buffer.from([1, 2, 255]),
    ]);
    assert.deepEqual(await call(db, "get", "SELECT value FROM data"), {
      value: Buffer.from([1, 2, 255]),
    });
    await call(db, "exec", "BEGIN; DELETE FROM data; ROLLBACK");
    assert.deepEqual(
      await call(db, "get", "SELECT count(*) AS count FROM data"),
      { count: 1 },
    );
    await assert.rejects(call(db, "get", "SELECT missing_column FROM data"));
    assert.deepEqual(await call(db, "get", "PRAGMA integrity_check"), {
      integrity_check: "ok",
    });
    return {
      fts5: true,
      parameterBinding: true,
      blobs: true,
      rollback: true,
      errorRecovery: true,
      compileOptions: await call(db, "all", "PRAGMA compile_options"),
    };
  } finally {
    await call(db, "close");
  }
}

function worker(args, timeout = 120_000) {
  const child = fork(script, args, {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const pending = [];
  const inbox = [];
  let exited;
  child.on("message", (message) => {
    if (pending.length) pending.shift().resolve(message);
    else inbox.push(message);
  });
  child.on("error", (error) => {
    exited = error;
    for (const waiter of pending.splice(0)) waiter.reject(error);
  });
  const exit = once(child, "exit").then(([code, signal]) => {
    exited = new Error(`Worker exited: ${code}/${signal}`);
    for (const waiter of pending.splice(0)) waiter.reject(exited);
    return { code, signal };
  });
  const timer = setTimeout(() => child.kill(), timeout);
  const receive = () =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : exited
        ? Promise.reject(exited)
        : new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return {
    child,
    receive,
    exit,
    stop: async () => {
      clearTimeout(timer);
      if (!exited) child.kill();
      await exit;
    },
  };
}

async function runCase(kind, aliases, processes) {
  const root = await mkdtemp(join(tmpdir(), "sqlite-native-"));
  let folder = root;
  if (kind === "long") {
    while (join(folder, "state.sqlite").length <= 280)
      folder = join(folder, "segment".repeat(4));
  }
  await mkdir(toNamespacedPath(folder), { recursive: true });
  const physical = join(folder, "state.sqlite");
  const filename = kind === "ordinary" ? physical : toNamespacedPath(physical);
  const alias =
    kind === "ordinary"
      ? join(folder, "STATE.sqlite")
      : toNamespacedPath(join(folder, "STATE.sqlite"));
  const writer = await open(
    filename,
    sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE,
  );
  const native = await call(
    writer,
    "get",
    "SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId",
  );
  try {
    await call(
      writer,
      "exec",
      "PRAGMA journal_mode=WAL; CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(42)",
    );
    assert.deepEqual(await call(writer, "get", "PRAGMA journal_mode"), {
      journal_mode: "wal",
    });
  } finally {
    await call(writer, "close");
  }
  const readers =
    processes === "cross-process"
      ? Array.from({ length: 5 }, (_, index) =>
          worker([
            "--reader",
            aliases === "case-alias" && index % 2 ? alias : filename,
          ]),
        )
      : [];
  let completedRounds = 0;
  let errors = [];
  try {
    await Promise.all(readers.map((reader) => reader.receive()));
    for (let round = 0; round < rounds; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, async (_, index) => {
          if (readers.length) {
            readers[index].child.send("read");
            const result = await readers[index].receive();
            if (result.error)
              throw Object.assign(
                new Error(result.error.message),
                result.error,
              );
          } else {
            await read(
              aliases === "case-alias" && index % 2 ? alias : filename,
            );
          }
        }),
      );
      errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => serializeError(result.reason));
      if (errors.length) break;
      completedRounds++;
    }
  } finally {
    await Promise.all(readers.map((reader) => reader.stop()));
  }
  const check = await open(filename, sqlite.OPEN_READWRITE);
  let integrity;
  try {
    integrity = await call(check, "get", "PRAGMA integrity_check");
    assert.deepEqual(integrity, { integrity_check: "ok" });
    assert.deepEqual(await call(check, "get", "SELECT value FROM marker"), {
      value: 42,
    });
  } finally {
    await call(check, "close");
  }
  await rm(toNamespacedPath(root), { recursive: true });
  return {
    kind,
    aliases,
    processes,
    physical,
    physicalLength: physical.length,
    filename,
    sqliteFilename: sqliteFilename(filename),
    native,
    rounds,
    completedRounds,
    errors,
    integrity,
    handlesReleased: true,
  };
}

if (process.argv[2] === "--reader") {
  process.on("message", () => {
    read(process.argv[3]).then(
      () => process.send({ ok: true }),
      (error) => process.send({ error: serializeError(error) }),
    );
  });
  process.send({ ready: true });
} else if (process.argv[2] === "--case") {
  try {
    process.send(await runCase(...process.argv.slice(3)));
  } catch (error) {
    process.send({ error: serializeError(error) });
  }
  process.disconnect();
} else {
  assert.equal(
    process.platform,
    "win32",
    "This diagnostic requires a real Windows filesystem",
  );
  const report = {
    commit: process.env.GITHUB_SHA,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    modulePath,
    sqliteVersion: sqlite.VERSION,
    packageVersion: JSON.parse(
      await readFile(join(dirname(modulePath), "..", "package.json"), "utf8"),
    ).version,
    rounds,
    variant: process.env.SQLITE_DIAGNOSTIC_VARIANT || "prebuilt",
    uriLongPath,
    cases: [],
    capabilities: await probeCapabilities(),
  };
  // Every matrix cell has a fresh DB/process; failures do not suppress other cells.
  for (const kind of ["ordinary", "extended-drive", "long"]) {
    for (const aliases of ["same-name", "case-alias"]) {
      for (const processes of ["single-process", "cross-process"]) {
        const task = worker(["--case", kind, aliases, processes]);
        let result;
        try {
          result = await task.receive();
        } catch (error) {
          result = { error: serializeError(error) };
        } finally {
          await task.stop();
        }
        report.cases.push({ kind, aliases, processes, ...result });
        console.log(JSON.stringify(report.cases.at(-1)));
      }
    }
  }
  const binary = Object.values(require.cache).find((entry) =>
    entry.id.endsWith(".node"),
  );
  if (binary)
    report.binarySha256 = createHash("sha256")
      .update(await readFile(binary.id))
      .digest("hex");
  const output = resolve(
    process.env.SQLITE_DIAGNOSTIC_REPORT || "test/.reports/sqlite-native.json",
  );
  await mkdir(dirname(output), { recursive: true });
  report.failed = report.cases.filter(
    (result) => result.error || result.errors?.length,
  ).length;
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      cases: report.cases.length,
      failed: report.failed,
      output,
    }),
  );
  // Diagnostic A/B runs record failures as evidence, never as acceptance success.
  if (report.failed) process.exitCode = 1;
}
