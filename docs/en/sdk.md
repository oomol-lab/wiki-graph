English | [中文](../zh-CN/sdk.md)

# SDK

This document describes how to use Wiki Graph from Node.js code through `wiki-graph-core`. Use the SDK when an application needs to create, read, query, or maintain `.wikg` archives without shelling out to the `wg` CLI.

## Packages

Install the SDK package when code needs programmatic access:

```bash
$ npm install wiki-graph-core
```

Install the CLI package when a user should receive the `wg` command:

```bash
$ npm install -g wiki-graph
```

The CLI package depends on `wiki-graph-core`. Application code should depend on `wiki-graph-core` directly.

## Main SDK

The main entrypoint is `wiki-graph-core`. It exposes archive sessions, archive query helpers, chapter operations, queue control, and shared types.

```ts
import { WikiGraph } from "wiki-graph-core";

const wikiGraph = new WikiGraph({});

await wikiGraph.digestTextStreamSession(
  {
    stream: ["Alpha is connected to beta.\n"],
    targetStage: "planned",
    title: "Research note",
  },
  async (archive) => {
    await archive.saveAs("research.wikg");
  },
);

await wikiGraph.openSession("research.wikg", async (archive) => {
  console.log(await archive.readMeta());
});
```

`targetStage: "planned"` creates an archive without calling an LLM. Stages that build a Reading Graph, Summary, or Knowledge Graph require LLM configuration.

## LLM Configuration

`WikiGraph` accepts any AI SDK `LanguageModel`. The SDK does not read CLI config files; applications pass their own model and runtime options.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { WikiGraph } from "wiki-graph-core";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const wikiGraph = new WikiGraph({
  llm: {
    cacheDirPath: ".wikigraph-cache",
    concurrent: 3,
    logDirPath: ".wikigraph-logs",
    model: openai("gpt-4.1-mini"),
  },
});
```

## Queue Control

Queue control belongs to the main SDK because callers may add, inspect, pause, resume, cancel, and clean jobs from an application process.

```ts
import { addBuildJob, listBuildJobs } from "wiki-graph-core";

const job = await addBuildJob({
  archivePath: "research.wikg",
  target: "knowledge-graph",
});

console.log(job.jobId);
console.log(await listBuildJobs({ archivePath: "research.wikg" }));
```

Adding a job does not spawn a worker. Process management is intentionally left to the application or CLI.

## Worker SDK

Use `wiki-graph-core/worker` only inside a process that is already meant to run queued build work. This entrypoint does not create a process.

```ts
import { runBuildJobWorker } from "wiki-graph-core/worker";

await runBuildJobWorker({
  concurrency: 1,
  executeJob: async (job, reporter, context) => {
    // Applications provide the job execution policy here.
    // The CLI wires this to Wiki Graph's built-in generation pipeline.
    context.signal.throwIfAborted();
    await reporter.stepStarted(job.target);
    await reporter.stepCompleted(job.target);
  },
});
```

Most applications should either use the CLI for background generation or provide their own worker process entrypoint that calls this SDK function.

## GC SDK

Use `wiki-graph-core/gc` inside a process that should perform local Wiki Graph cleanup.

```ts
import { tryRunWikiGraphGc } from "wiki-graph-core/gc";

const report = await tryRunWikiGraphGc({
  dryRun: false,
  force: false,
});

console.log(report);
```

The GC SDK runs cleanup in the current process. It does not spawn or schedule another process.

## Process Boundary

The SDK has three process-local surfaces:

- `wiki-graph-core`: application and queue-control APIs.
- `wiki-graph-core/worker`: build worker APIs for an already-started worker process.
- `wiki-graph-core/gc`: cleanup APIs for an already-started GC process.

Process creation is outside the SDK. The `wg` CLI uses its own private worker entrypoint for background jobs; applications should do the same if they need background workers.

## Related Documents

- [`.wikg` Archive Standard](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
