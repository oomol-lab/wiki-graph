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

## Wikipedia request isolation and cancellation

`archive.page("wikg://entity/Q42/wikipage", { signal })` and
`wikiGraph.libraries.page(libraryUri, "wikg://entity/Q42/wikipage", { signal })`
resolve remote Wikipedia data after releasing local Archive/Library read
sessions. A stalled or failed request does not block other local reads, searches
or writes. Local transaction coordination remains in effect.

Wikimedia resolution has a default 120-second deadline across fetch, streaming,
cache waits and retries; expiry rejects with an error whose `code` is
`"WIKIMEDIA_TIMEOUT"`. Caller cancellation rejects with the signal's reason.
Pass your application's cancellation signal rather than only abandoning its
outer promise:

```ts
const page = await archive.page("wikg://entity/Q42/wikipage", {
  signal: AbortSignal.timeout(15_000),
});
```

## Schema versions and explicit maintenance

Constructing the SDK starts no background I/O. Async archive opening and library
lookup check versions before returning a handle. Storage access rechecks versions,
including after resource replacement. Library registration belongs to Home schema;
looking up a library does not open its members. Members are checked individually
when accessed.

Ordinary access never upgrades old data or rebuilds missing/dirty search indexes.
Empty Home state initialization and interrupted transaction recovery are allowed.
Use explicit maintenance for upgrades, and `ensureSearchIndex()` or index sync for
derived search state.

```ts
import {
  createWikiGraphSDK,
  isWikiGraphSchemaVersionError,
} from "wiki-graph-sdk";

const sdk = createWikiGraphSDK({ stateDir: "/var/lib/my-app/wiki-graph" });
try {
  await sdk.libraries.get("wikg://lib");
} catch (error) {
  if (!isWikiGraphSchemaVersionError(error)) throw error;
  console.error(error.target, error.actualVersion, error.supportedVersion);
  if (error.reason === "upgrade-required") {
    // Ask the operator to run maintenance; do not upgrade automatically in catch.
    console.error("Manual schema upgrade required", error.target);
  } else {
    console.error("Update Wiki Graph to read this newer data");
  }
} finally {
  sdk.close();
}
```

`WikiGraphSchemaVersionError` extends Core's error hierarchy, with stable code
`schema_version_incompatible`. The guard accepts local instances, duplicate-package
instances and intact structured records containing code, target, both versions and
reason. It does not use message text. Structured records do not regain Error
methods or a stack. Missing/corrupt manifests, permissions and database I/O errors
are not version errors. Only `upgrade-required` indicates manual upgrade is
appropriate; `newer-version` requires newer software.

After operator approval, explicitly call `await sdk.maintenance.upgrade(error.target)`
for an `upgrade-required` error whose target you retained. In the CLI use
`wg maintenance upgrade home`, `wg maintenance upgrade <archive-path>`, or
`wg maintenance upgrade <library-uri>` as indicated by the error. Home v4 must be
manually upgraded to v5 before other state operations; archive schema remains v5.

Directory archives read manifest and requested paths directly. ZIP lookups scan
the central directory on demand (O(files)) without retaining a full entry map;
ZIP database queries may materialize a database. Directory read-only queries avoid database copying and
hashing. Existing search caches are also read directly under a session lock; explicit
cache writers retain transactional snapshots. Full scans and sync remain explicit. External changes outside SDK writes
require scan/sync; accessed members still receive local checks.

Archive query preflight uses coverage summaries bound to the synced revision.
Unscoped queries do not enumerate chapters; chapter URI queries use the synced
path index, and `skipUnindexed` filters eligible chapters inside result SQL.
Partial sync still records the complete chapter topology and marks projection
and query eligibility separately: strict queries check the real subtree, while
`skipUnindexed` only filters eligible results. An older derived cache without
these summaries and the complete-topology marker requires explicit index sync.

## Durable Jobs

The job manager creates and queries durable work. A `WikiGraphJob` is a handle
whose lifecycle is independent of any observer.

```ts
const job = await wikiGraph.jobs.create({
  archive: { kind: "standalone", path: "/data/research.wikg" },
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

Archive targets are always explicit. Use `{ kind: "standalone", path }` for
an unmanaged WIKG file and `{ kind: "library", uri }` for a library archive
UUID URI. The SDK rejects a standalone path inside a registered library and
never exposes a managed archive's physical path through handles or snapshots.

Events are also available as an async iterable and accept an `AbortSignal`:

```ts
for await (const event of job.events({ signal })) console.log(event);
```

`wikiGraph.config` reads and writes the same local configuration used by the
CLI. `wikiGraph.libraries` returns typed library instances. SDK results are
objects, not serialized JSON or terminal text.

Library search can expose several independently paginated result buckets from
one shared query session. Scores in every bucket come from the same candidate
set and normalization pass:

```ts
const result = await wikiGraph.libraries.searchBuckets(library.uri, query, {
  buckets: [
    { id: "titles", types: ["archive-title", "chapter-title"] },
    { id: "knowledge", types: ["entity", "triple"] },
    { id: "reading", types: ["node"] },
    { id: "text", types: ["source", "summary"] },
  ],
  limitPerBucket: 3,
  queryMode: "hybrid",
});

const text = result.buckets.find((bucket) => bucket.id === "text");
const nextTextPage =
  text?.nextCursor === null || text?.nextCursor === undefined
    ? undefined
    : await wikiGraph.libraries.continueSearchBucket(
        library.uri,
        text.nextCursor,
        { limit: 12 },
      );
```

Advancing one bucket does not move any sibling cursor. The existing
`libraries.search()` method and CLI search output retain their sequential
single-cursor behavior.

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

Custom ZIP adapters must honor `zip.open(file, { entryNameMode: "normalized" })`
for WIKG access: normalize names, choose the last distinct raw name in
first-occurrence order, and read its last duplicate. Default/raw mode retains
exact-name lookup for EPUB and other containers. Wrappers must forward the
options; an eager full-directory cache is not required.

Node applications that own worker or cleanup processes can import
`wiki-graph-sdk/worker` and `wiki-graph-sdk/gc`. These functions run in the
current process; they do not spawn or schedule another process. Both entry
points install the Node platform themselves and accept `stateDir` to select the
same state root as a `WikiGraphSDK` instance:

```ts
import { tryRunWikiGraphGc } from "wiki-graph-sdk/gc";
import { runBuildJobWorker } from "wiki-graph-sdk/worker";

await tryRunWikiGraphGc({ dryRun: true, stateDir: "/srv/wiki-graph" });
await runBuildJobWorker({
  concurrency: 2,
  executeJob,
  stateDir: "/srv/wiki-graph",
});
```

When omitted, `stateDir` defaults to `~/.wikigraph`. Storage is scoped to each
invocation, so concurrent calls using different state roots remain isolated.

## Related Documents

- [`.wikg` Archive Standard](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)

## Public objects and raw retrieval signals

The SDK exports shared Core business models: `WikiGraphObjectIdentity`,
`WikiGraphObject`, `WikiGraphObjectSummary`, `WikiGraphSearchableSummary`,
`WikiGraphObjectListItem`, and `WikiGraphObjectDetails`. Summaries describe only
facts already available in that projection; they do not load full text, mentions,
or evidence to populate fields. `ArchiveFindHit` combines a discriminated summary
with search matching information (`score`, `snippet`, terms, position, evidence).
Collections and related results use the same model family, with appropriate list
or detail projections. These are plain objects, not new class instances.

`archive` and `chapter` are scope projections; `archive-title` and `chapter-title`
are their title objects. A reading-graph chunk retains the historical `type:
"node"` discriminant and is named `WikiGraphChunkSummary` / `WikiGraphChunkDetails`
in the public model. Object identifiers continue to use chunk URIs.

```ts
import type { ArchiveFindHit, WikiGraphTripleSummary } from "wiki-graph-sdk";

function inspectHit(hit: ArchiveFindHit) {
  if (hit.type === "triple") {
    const triple: WikiGraphTripleSummary = hit;
    console.log(triple.triple.predicate); // required after narrowing
  } else if (hit.type === "source" || hit.type === "summary") {
    console.log(hit.score, hit.ftsScore, hit.embeddingScore);
  }
  for (const evidence of hit.evidence?.sources ?? []) {
    console.log(evidence.ftsScore, evidence.embeddingScore);
  }
}

const hits = await archive.search("your query", { sourceContext: 0 });
for (const hit of hits) inspectHit(hit);
const evidence = await archive.evidence("wikg://entity/Q1", {
  query: "your query",
  sourceContext: 0,
});
for (const source of evidence)
  console.log(source.ftsScore, source.embeddingScore);
```

Raw signals are optional on source/summary sentence hits and on source evidence
when a single matched sentence can be identified. Entity, Triple and Chunk hits
do not aggregate or expose these fields themselves. Queryless evidence has no
signals. Archive and Library results, including cursor pages, follow the same
rules. Multiple matched sentences or segments merged into one displayed range
omit raw signals rather than choose an arbitrary representative score. Context
around a single match is display context; its signals still refer to that match.

Currently `ftsScore` is raw SQLite BM25 (smaller is better); BM25 across queries
is not a universal absolute threshold. `embeddingScore` is raw cosine similarity
(larger is more similar), inherited from the embedding segment containing the
sentence, not an independent sentence embedding. Overlapping segments retain the
existing ranking selection. Cosine depends on the model and segmentation. A
missing channel is `undefined`, not zero; a supplied zero remains zero. Signals
are references, not hit probabilities or a new filtering API. Algorithm changes
must update these documented semantics. Final `score`, recall, four-bucket
ordering, evidence ordering and pagination remain unchanged. CLI output does not
expose these SDK fields.
