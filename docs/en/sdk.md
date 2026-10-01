English | [中文](../zh-CN/sdk.md)

# Node.js SDK

`wiki-graph-sdk` is the programmatic delivery package behind the `wg` CLI. Use
it when a Node.js application needs the same local configuration, libraries,
filesystem defaults, and durable jobs without constructing commands or parsing
stdout.

```bash
$ npm install wiki-graph-sdk
```

The package requires Node.js `>=22.12.0`. It depends on the runtime-neutral
`wiki-graph-core`; applications do not need to install Core separately.

## Runtime Instance

Create one instance for each application runtime context. Explicit options are
preferred for tests and embedded applications; the defaults match the CLI's
Node environment.

```ts
import { createWikiGraphSDK } from "wiki-graph-sdk";

const wikiGraph = createWikiGraphSDK({
  cwd: process.cwd(),
  stateDir: "/var/lib/my-app/wiki-graph",
});

await wikiGraph.config.put("concurrent", "job", 2);
const libraries = await wikiGraph.libraries.list();
const jobs = await wikiGraph.jobs.list({ activeOnly: true });

wikiGraph.close();
```

The SDK exposes typed methods and class instances. It intentionally does not
provide `execute(command, args)`: argument parsing, help, terminal remediation,
exit codes, and JSON/JSONL rendering belong to `wiki-graph`.

## Durable Jobs

The job manager creates and queries durable work. A `WikiGraphJob` is a handle
whose lifecycle is independent of any observer.

```ts
const job = await wikiGraph.jobs.create({
  archive: "/data/research.wikg",
  chapterId: 12,
  target: "reading-summary",
});

const unsubscribe = job.subscribe((event) => console.log(event));
await job.pause();
await job.resume();
console.log(await job.status());

unsubscribe(); // Stops this observer; it does not cancel durable work.
await job.cancel(); // Explicitly cancels the job.
```

Events are also available as an async iterable and accept an `AbortSignal`:

```ts
for await (const event of job.events({ signal })) console.log(event);
```

`wikiGraph.config` reads and writes the same local configuration used by the
CLI. `wikiGraph.libraries` returns typed library instances. SDK results are
objects, not serialized JSON or terminal text.

## Core for Other JavaScript Hosts

Use `wiki-graph-core` directly only when building a runtime adapter, such as a
browser or Chrome extension host. Core has no Node dependency and does not own
local config discovery, filesystem paths, CLI help, or terminal messages. The
host supplies `File`, `Directory`, database, ZIP, template, async-context, and
lifecycle implementations through `WikiGraphPlatform`.

```ts
import {
  installWikiGraphPlatform,
  WikiGraph,
  type Directory,
  type ReadonlyFile,
  type WikiGraphPlatform,
} from "wiki-graph-core";

installWikiGraphPlatform(myPlatform satisfies WikiGraphPlatform);
const wikiGraph = new WikiGraph({
  storage: {
    library: myLibraryDirectory satisfies Directory,
    documentStore: myDocumentDirectory satisfies Directory,
  },
});

await wikiGraph.openSession(
  myArchiveFile satisfies ReadonlyFile,
  async (archive) => console.log(await archive.readMeta()),
);
```

Browser adapters may back these capabilities with OPFS, IndexedDB, or another
scoped store. Core treats resource identities as opaque coordination keys and
keeps ZIP and database access behind host providers.

Node applications that own worker or cleanup processes can import
`wiki-graph-sdk/worker` and `wiki-graph-sdk/gc`. These functions run in the
current process; they do not spawn or schedule another process.

## Related Documents

- [`.wikg` Archive Standard](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
