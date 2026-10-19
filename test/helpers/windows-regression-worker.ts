import { join } from "path";
import { createWikiGraphSDK } from "wiki-graph-sdk";
import { NodeFile, nodeWikiGraphPlatform } from "wiki-graph-sdk/node-platform";

const [mode, root] = process.argv.slice(2);
if (root === undefined) throw new Error("Missing regression worker root");

if (mode === "wal") {
  const database = await nodeWikiGraphPlatform.database.open(
    new NodeFile(root),
    {
      create: true,
      mode: "readwrite",
    },
  );
  process.on(
    "message",
    (message: { id: number; sql?: string; close?: boolean }) => {
      void (async () => {
        try {
          if (message.close === true) {
            await database.close();
            process.send?.({ id: message.id, value: null }, () =>
              process.disconnect(),
            );
          } else {
            const value = await database.queryAll(message.sql!);
            process.send?.({ id: message.id, value });
          }
        } catch (error) {
          process.send?.({ id: message.id, error: String(error) });
        }
      })();
    },
  );
  process.send?.({ ready: true });
} else {
  const sdk = createWikiGraphSDK({ cwd: root, stateDir: join(root, "state") });
  const target = { kind: "standalone", path: join(root, "book.wikg") } as const;
  try {
    if (mode === "build") {
      await sdk.archives.create({ path: target.path });
      const archive = await sdk.archives.open(target);
      const chapter = await archive.addChapter({
        title: "Windows archive regression",
        source:
          "The observatory records starlight. Astronomers preserve observations.",
      });
      const queued = await sdk.jobs.enqueue({
        archive: target,
        chapterId: chapter.chapterId,
        target: "index-fts",
      });
      const job = queued.created[0]?.job;
      if (job === undefined) throw new Error("FTS job was not queued");
      // Exercise multiple atomic event-log appends before running the real worker.
      await job.pause();
      await job.resume();
      await sdk.jobs.runWorker({ idleTimeoutMs: 100 });
      const status = await job.status();
      if (status.state !== "succeeded") throw new Error(JSON.stringify(status));
      await archive.syncSearchIndex();
      const events = [];
      for await (const event of job.events({ from: "beginning" }))
        events.push(event);
      process.send?.({ value: { jobId: job.id, events, status } });
    } else if (mode === "reopen") {
      const archive = await sdk.archives.open(target);
      const hits = await archive.search("observatory", { queryMode: "fts" });
      const jobs = await sdk.jobs.list({ all: true });
      const events = [];
      for await (const event of jobs[0]!.events({ from: "beginning" }))
        events.push(event);
      process.send?.({
        value: {
          hits: hits.items,
          events,
          chapters: await archive.listChapters(),
        },
      });
    } else throw new Error(`Unknown mode ${mode}`);
  } finally {
    sdk.close();
    process.disconnect();
  }
}
