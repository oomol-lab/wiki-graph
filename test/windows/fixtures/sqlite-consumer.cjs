// Runs from an isolated packed consumer. No workspace/core/internal imports.
/* global __filename */
const process = require("node:process");
const console = require("node:console");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { Worker, workerData, parentPort } = require("node:worker_threads");
const { createRequire } = require("node:module");
const [entry, mode, root] = workerData || process.argv.slice(2);
let phase = "imports";

async function main() {
  const baselineRequire = process.env.SQLITE_CONSUMER_BASELINE_ROOT
    ? createRequire(
        join(process.env.SQLITE_CONSUMER_BASELINE_ROOT, "package.json"),
      )
    : undefined;
  const load = async (specifier) =>
    baselineRequire
      ? baselineRequire(specifier)
      : entry === "cjs"
        ? require(specifier)
        : await import(specifier);
  const { createWikiGraphSDK } = await load("wiki-graph-sdk");
  const { nodeWikiGraphPlatform, NodeFile } = await load(
    "wiki-graph-sdk/node-platform",
  );
  assert.equal(
    typeof (await load("wiki-graph-sdk/worker")).runBuildJobWorker,
    "function",
  );
  assert.equal(
    typeof (await load("wiki-graph-sdk/default-worker"))
      .runWikiGraphQueueWorker,
    "function",
  );
  phase = "database-open";
  const db = await nodeWikiGraphPlatform.database.open(
    new NodeFile(join(root, "probe.db")),
    { mode: "readwrite", create: true },
  );
  let duplicate;
  let native;
  try {
    phase = "database-schema";
    await db.execute(
      "CREATE TABLE IF NOT EXISTS probe(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO probe VALUES(1)",
    );
    try {
      phase = "duplicate-statement";
      await db.execute("INSERT INTO probe VALUES(1)");
    } catch (error) {
      duplicate = {
        code: error.code,
        errno: error.errno,
        primaryCode: error.primaryCode,
      };
    }
    assert.ok(duplicate, "duplicate must reject");
    assert.equal(duplicate.code, "SQLITE_CONSTRAINT");
    assert.equal(duplicate.errno, 19);
    phase = "integrity-after-error";
    assert.equal(
      (await db.queryOne("PRAGMA integrity_check")).integrity_check,
      "ok",
    );
    native = await db.queryOne(
      "SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId",
    );
    if (process.env.SQLITE_CONSUMER_PRODUCT === "true")
      assert.equal(native.version, "3.50.4");
  } finally {
    phase = "database-close";
    await db.close();
  }
  const sdk = createWikiGraphSDK({ cwd: root, stateDir: join(root, "state") });
  const target = { kind: "standalone", path: join(root, "book.wikg") };
  try {
    if (mode === "worker") {
      phase = "job-worker";
      await sdk.jobs.runWorker({ idleTimeoutMs: 100 });
    } else if (mode === "create" || mode === "append") {
      phase = "archive-create";
      if (mode === "create") await sdk.archives.create({ path: target.path });
      phase = "archive-open";
      const archive = await sdk.archives.open(target);
      phase = "chapter-source";
      const chapter = await archive.addChapter({
        title: "Offline consumer",
        source:
          "The observatory records starlight. Astronomers preserve observations.",
      });
      phase = "job-enqueue";
      const queued = await sdk.jobs.enqueue({
        archive: target,
        chapterId: chapter.chapterId,
        target: "index-fts",
      });
      const job = queued.created[0].job;
      phase = "job-events";
      await job.pause();
      await job.resume();
      phase = "worker-thread";
      await new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: [entry, "worker", root],
        });
        worker.once("error", reject);
        worker.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
        );
      });
      assert.equal((await job.status()).state, "succeeded");
      phase = "index-sync";
      await archive.syncSearchIndex();
    } else if (mode === "reopen") {
      phase = "archive-reopen";
      const archive = await sdk.archives.open(target);
      assert.ok(
        (await archive.search("observatory", { queryMode: "fts" })).items
          .length > 0,
      );
      const jobs = await sdk.jobs.list({ all: true });
      const events = [];
      for await (const event of jobs[0].events({ from: "beginning" }))
        events.push(event.type);
      for (const type of [
        "created",
        "paused",
        "resumed",
        "started",
        "succeeded",
      ])
        assert.ok(events.includes(type), type);
    } else throw new Error(`Unknown mode ${mode}`);
    console.log(
      JSON.stringify({
        entry,
        mode,
        node: process.version,
        electron: process.versions.electron,
        napi: process.versions.napi,
        duplicate,
        native,
      }),
    );
  } finally {
    sdk.close();
  }
}
main().then(
  () => parentPort?.close(),
  (error) => {
    console.error({ phase, error });
    process.exitCode = 1;
    parentPort?.close();
  },
);
