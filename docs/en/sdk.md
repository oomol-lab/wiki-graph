English | [中文](../zh-CN/sdk.md)

# SDK

This document describes how to use Wiki Graph through `wiki-graph-core`. Use
the SDK when an application needs to create, read, query, or maintain `.wikg`
archives without shelling out to the `wg` CLI. Core is runtime-neutral: the
host provides `File` and `Directory` implementations, while the Node-only
filesystem, SQLite, and ZIP wiring remains private to the CLI.

## Packages

Install the SDK package when code needs programmatic access:

```bash
$ npm install wiki-graph-core
# or
$ pnpm add wiki-graph-core
```

Install the CLI package when a user should receive the `wg` command:

```bash
$ npm install -g wiki-graph
# or
$ pnpm add --global wiki-graph
```

The installed CLI command is self-contained for normal `wg` usage. Application
code should depend on `wiki-graph-core` directly when it needs the core SDK. If
an application uses the `wiki-graph` package's programmatic CLI runner entry, it
should install both `wiki-graph` and `wiki-graph-core` so the runner can share
the same core package as the application.

## Main SDK

The main entrypoint is `wiki-graph-core`. It exposes archive sessions, archive query helpers, chapter operations, queue control, and shared types.

### Host storage

Before opening or creating archives, install two host-owned directory roots:

```ts
import {
  installWikiGraphPlatform,
  WikiGraph,
  type Directory,
  type File,
  type WikiGraphPlatform,
} from "wiki-graph-core";

installWikiGraphPlatform(myPlatform satisfies WikiGraphPlatform);

const storage = {
  library: myLibraryDirectory satisfies Directory,
  documentStore: myDocumentDirectory satisfies Directory,
};
const wikiGraph = new WikiGraph({ storage });

const archive = myArchiveFile satisfies File;
await wikiGraph.openSession(archive, (session) => session.readMeta());
```

`File`/`Directory` are platform primitives. Core never interprets their URI or
absolute path; browser and extension hosts can back them with IndexedDB,
OPFS, or another scoped store. The `wiki-graph` CLI supplies the Node adapter.
Each `File.identity` and `Directory.identity` is a stable, opaque coordination
key—not a path or URI.
Hosts implement four independent `File` access modes: `read()` reads the
complete file; `openReader()` returns a bounded byte-range reader; `write()`
appends sequential data to a transactional writer; and `writeAt()` writes bytes
at an absolute offset in that writer. A reader rejects ranges outside its
reported size. A writer publishes its complete snapshot only on `commit()` and
discards it on `abort()`; positioned writes do not advance its sequential
write position. ZIP and SQLite remain separate platform providers, so their
storage strategies are chosen by the host rather than by `File`.
Archive SQLite workspaces are created only below the supplied `documentStore`
and are removed after the archive session settles. Derived search indexes are
kept there as persistent caches under opaque, path-free keys; they remain
outside the `.wikg` archive and can be rebuilt at any time.
`WikiGraphPlatform` is process-wide host infrastructure for async context,
database, ZIP, resource resolution, and execution-liveness operations, so an
application installs it once after import. Its ZIP reader lists entry names and
reads entry data on demand; hosts must not require Core to load the complete
archive for an ordinary read. Its lifecycle provider gives each running host
instance an opaque ID and reports whether a previously recorded instance is
still alive, allowing archive sessions to recover published work after a crash.
The two storage roots belong to each `WikiGraph` instance and remain isolated
when instances run concurrently.

```ts
import { WikiGraph, type File } from "wiki-graph-core";

const wikiGraph = new WikiGraph({ storage });
const outputArchive = myOutputArchiveFile satisfies File;

await wikiGraph.digestTextStreamSession(
  {
    stream: ["Alpha is connected to beta.\n"],
    targetStage: "planned",
    title: "Research note",
  },
  async (archive) => {
    await archive.saveAs(outputArchive);
  },
);

await wikiGraph.openSession(outputArchive, async (archive) => {
  console.log(await archive.readMeta());
});
```

`targetStage: "planned"` creates an archive without calling an LLM. Stages that build a Reading Graph, Summary, or Knowledge Graph require LLM configuration.

### Source locators

Source text, evidence, and query results stay focused on readable text. When a
caller needs imported-file provenance, Core exposes the same independent
locator collection as the CLI:

```ts
import {
  listArchiveSourceLocators,
  readArchivePage,
  WikiGraphArchiveFile,
} from "wiki-graph-core";

const archiveFile = new WikiGraphArchiveFile(myArchiveFile);
await archiveFile.readDocument(async (document) => {
  const page = await listArchiveSourceLocators(
    document,
    "wikg://chapter/<chapter-path>/source/locators#1..3",
    { limit: 20 },
  );
  const location = await readArchivePage(document, page.items[0]!.uri);
});
```

Each item maps a 1-based inclusive Unicode-character `range` to an artifact
locator `uri`. The optional URI fragment selects source sentences first;
pagination uses `nextCursor`.

## LLM Configuration

`WikiGraph` accepts any AI SDK `LanguageModel`. The SDK does not read CLI config files; applications pass their own model and runtime options.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { WikiGraph, type Directory } from "wiki-graph-core";

const openai = createOpenAI({
  apiKey: "<your-openai-api-key>",
});

const wikiGraph = new WikiGraph({
  llm: {
    cacheDirectory: myCacheDirectory satisfies Directory,
    concurrent: 3,
    logDirectory: myLogDirectory satisfies Directory,
    model: openai("gpt-4.1-mini"),
  },
  storage,
});
```

Wiki Graph does not automatically read `OPENAI_API_KEY` or any CLI provider
configuration. Your application owns credential loading and must pass its fully
configured AI SDK `LanguageModel` through the `WikiGraph` `llm` option.

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
