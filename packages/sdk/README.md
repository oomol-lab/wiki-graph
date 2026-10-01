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

Job event subscriptions observe durable work without coupling observation to
cancellation. Call `job.cancel()` explicitly to cancel a job; unsubscribing
only stops the current listener.

The SDK intentionally has no `execute(command, args)` API. CLI argument
parsing, help text, terminal formatting, JSON, and JSONL rendering belong to
the `wiki-graph` package. SDK methods return typed objects and job events.
