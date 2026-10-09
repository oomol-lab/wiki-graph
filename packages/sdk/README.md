# wiki-graph-sdk

The Node.js application SDK behind the `wiki-graph` CLI. It provides typed,
programmatic access to local configuration, libraries, durable build jobs, and
the runtime-neutral APIs from `wiki-graph-core`.

Requires Node.js `>=22.12.0`.

```bash
npm install wiki-graph-sdk
```

```ts
import { createWikiGraphSDK } from "wiki-graph-sdk";

const wikiGraph = createWikiGraphSDK({ stateDir: "/path/to/state" });
const jobs = await wikiGraph.jobs.list();

for (const job of jobs) {
  console.log(job.snapshot);
}

wikiGraph.close();
```

Electron and other Node hosts may provide their own lifecycle identity and
storage layout without importing `wiki-graph-core`:

```ts
import {
  createNodeWikiGraphPlatform,
  createNodeWikiGraphStorage,
  createWikiGraphSDK,
} from "wiki-graph-sdk";

const wikiGraph = createWikiGraphSDK({
  host: {
    platform: createNodeWikiGraphPlatform({ lifecycle }),
    storage: createNodeWikiGraphStorage({
      libraryRoot: "/path/to/home",
      documentStoreRoot: "/path/to/documents",
    }),
  },
});
```

Storage is scoped to the SDK instance. Platform services, including lifecycle,
are process-wide; SDK instances in one process must use one compatible
platform. `host.storage` and `stateDir` cannot be supplied together.

Applications may replace the configured LLM and embedding implementations for
one SDK instance:

```ts
const wikiGraph = createWikiGraphSDK({
  providers: {
    llm: myStreamingLLMProvider,
    embedding: myEmbeddingProvider,
  },
});

await wikiGraph.jobs.runWorker();
```

An operation-level `llm` option (the typed SDK equivalent of CLI `--llm`)
takes precedence over the injected LLM provider. An injected provider takes
precedence over local database configuration. Injected objects are
process-local and are not persisted with durable jobs, so a worker in another
process must create its SDK with the same providers. The standalone default
worker continues to use local configuration.

Job event subscriptions observe durable work without coupling observation to
cancellation. Call `job.cancel()` explicitly to cancel a job; unsubscribing
only stops the current listener.

Services that receive chapter job artifacts as files can apply an ordered,
lazy sequence through the Node delivery boundary without importing Core:

```ts
import { applyWikiGraphJobArtifacts } from "wiki-graph-sdk/worker";

await applyWikiGraphJobArtifacts({
  archive: { kind: "standalone", path: "/tmp/job/archive.wikg" },
  artifacts,
  stateDir: "/tmp/job/sdk-state",
});
```

Each artifact carries its chapter, job kind, and source revision. The operation
stops before consuming later artifacts when a revision no longer matches.

The SDK intentionally has no `execute(command, args)` API. CLI argument
parsing, help text, terminal formatting, JSON, and JSONL rendering belong to
the `wiki-graph` package. SDK methods return typed objects and job events.
