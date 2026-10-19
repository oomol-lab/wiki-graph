# Changelog

## 0.9.6

- Fence Archive reader admission against physical commits, including manifest/schema probes, and distinguish reading, drained settlement, and completed logical operations across processes. Defer ZIP settlement behind active readers without blocking callbacks; the last drained session or recovery reaper persists completed overlays. Keep mutation tokens pinned to their original source reader and discard search caches built over deferred changes.
- Make SDK standalone export drain readers and settle pending writes before copying a coherent snapshot; reject exporting onto the source itself. Directory export uses the existing transaction/recovery lock.
- Coordinate cold open/first WAL header read/close transitions for namespaced Windows SQLite paths to avoid `SQLITE_PROTOCOL` during concurrent readonly reopening, including case aliases. Queries and transactions remain concurrent; ordinary short paths keep the 0.9.4 path policy, and no retry, checkpoint, locking bypass or extra writable connection is introduced.
- Require complete Windows regression files with no missing, skipped, or todo cases. Cover offline SDK FTS/jobs/event-log workflows, opaque ZIP close/commit failures, concurrent settlement/admission and interrupted-owner recovery, active WAL transactions and killed-writer recovery on ordinary/extended/long paths, and path conversion contracts (not SMB I/O certification).
- Core, SDK, and CLI advance together from published 0.9.5. Home v6, Archive schema v5, and WIKG format v1 are unchanged; optional coordinator settlement metadata is added by the existing derived-state bootstrap, without migrating archive or Home data. Stop older workers before switching versions; mixed-version concurrent workers are not supported.

## 0.9.5

- Shorten WIKG coordinator workspace snapshot paths with a single composite hash and compact Windows-safe snapshot names.
- Treat obsolete workspace snapshots as disposable cache during the explicit Home schema upgrade and add Windows long-path handling at Node filesystem, ZIP, and SQLite boundaries.
- Expose stable SDK archive export/schema inspection and database platform types for host integrations.
- Preserve existing WIKG mutation tokens on archive re-export and write deterministic ZIP timestamps.
- Shorten WikiGraphTaskContext identifiers with full SHA-256 Base32 hashes and add cross-platform ZIP/SQLite regression coverage.
- Add a read-only SDK archive facade for overview and chapter data, reusing the versioned `WikgObject` discriminated union without exposing Core readers.

## 0.9.4

- Close archive readers before archive settlement and physical replacement, preventing Windows `EPERM` failures when a `.wikg` archive is still open.
- Keep archive ownership registered until reader, lease, writer, rollback, and recovery cleanup has completed.
- Add ZIP archive coordination regression coverage for delayed reader release and replacement ordering.

## 0.9.2

- Resolve entity Wikipedia pages outside Archive and Library local read sessions, so stalled external requests cannot block subsequent searches, reads or writes.
- Bound Wikimedia resolution with a default 120-second deadline and propagate cancellation through fetch, streaming, cache waits and retries. Release stream readers and singleflight state on errors, timeout and cancellation.
- Route Library entity Wikipedia page lookups through the entity index without scanning archives.
- Publish `wiki-graph-wikimedia` 0.8.1 with this fix; Core, SDK and CLI are 0.9.2. Home and Archive schema versions are unchanged and no migration from 0.9.1 is required.
- Treat an explicitly empty reading summary as completed across Core, SDK and CLI, while keeping missing summaries distinct.
- Allow completed empty summaries to produce a current empty embedding index without calling the embedding provider.
- Publish `wiki-graph-job` 0.8.1 with these summary completion fixes.

## 0.9.1

- Require explicit Home/Archive schema upgrades and index sync; ordinary SDK/CLI access checks versions and readiness without full member scans or implicit rebuilds.
- Upgrade Home schema from v4 to v5 through manual maintenance, adding indexed physical identities and migrating membership columns. Archive schema remains v5.
- Replace the ZIP entry metadata cache with on-demand lookups while preserving legacy normalized-name precedence and unique logical entry enumeration.
- Centralize SDK object types as discriminated unions and expose optional raw `ftsScore` and `embeddingScore` on sentence hits and attributable source evidence. CLI output and ranking remain unchanged.

### Migration from 0.9.0

Update `wiki-graph-core`, `wiki-graph-sdk`, and `wiki-graph` together to `0.9.1`.
Back up Home and registered Library folders, stop active jobs, then run
`wg maintenance upgrade home`. Ordinary access rejects Home v4 and never upgrades
it automatically. Existing v5 archives, including managed directories, need no
archive migration. Libraries share the Home schema and have no separate schema
version.

Run `wg <archive-uri>/index sync` and `wg <library-uri>/index sync` before querying
old projections that lack readiness summaries, or after artifacts/members change.
Sync rebuilds derived caches from existing artifacts; it does not generate missing
artifacts or call an embeddings provider. See [the schema upgrade guide](docs/schema-upgrade.md).

## 0.9.0

- Store Library-managed archives as directories while keeping standalone `.wikg` archives as ZIP files for distribution.
- Resolve managed and standalone archive storage transparently through the existing CLI and SDK access paths.
- Coordinate managed archive writes with transactional Library membership updates and recovery.
- Migrate registered ZIP members through `wg maintenance upgrade wikg://lib`, including members whose database schema is already current.
- Report storage migrations separately from schema upgrades and return a nonzero CLI exit status for partial upgrades.

### Migration from 0.8.4

Back up your Library before running `wg maintenance upgrade wikg://lib`, then
refresh its aggregate index with `wg wikg://lib/index sync`. Upgrading the Home
schema alone does not convert Library members. Home schema v4 and archive schema
v5 remain unchanged; this release migrates managed archive storage.

Version 0.8.4 cannot open managed directory archives. To roll back, restore the
backup. Standalone `.wikg` archives remain ZIP files for interchange. See
[the schema upgrade guide](docs/schema-upgrade.md) for migration details.

## 0.8.4

- Preserve nested PCEX `toc.xml` hierarchy when converting source documents to WIKG chapters.
- Keep TOC-only directory nodes and stable chapter paths in conversion output.

## 0.8.3

- Isolate SDK configuration state with an explicit `host.stateDir` when hosts
  provide custom library and document storage.
- Keep the same Host state boundary across SDK operations, workers, artifact
  delivery, and garbage collection.
- Fix Library aggregate-index Hybrid pagination so the fused continuation key
  is not applied to the underlying FTS candidate query.
- Add real aggregate-index pagination coverage for FTS, Embedding, and Hybrid
  searches through `sdk.libraries.search()`.

### Migration from 0.8.2

Hosts that provide `host.storage` should also provide `host.stateDir` for SDK
configuration and other Node-local state. The top-level `stateDir` remains the
shorthand for the default Node storage layout and cannot be combined with Host
state or storage options.

## 0.8.2

- Expose the SDK host, search-mode, source-locator, URI, and storage types needed by Node and Electron hosts without importing `wiki-graph-core` directly.
- Add SDK archive search-session clearing and preserve callback-scoped managed archive reads.
- Add an SDK host boundary for custom Node lifecycle identity and independently rooted library and document storage.
- Fix FTS keyset pagination when a dense index is present but the query explicitly uses `fts`; hybrid cursors remain applied after RRF fusion.
- Add real-index pagination coverage for FTS, embedding, and hybrid queries.

### Migration from 0.8.1

Update `wiki-graph-core`, `wiki-graph-sdk`, and `wiki-graph` together to `0.8.2`. Consumers can import the newly exposed public types and URI helpers from `wiki-graph-sdk`; no direct Core import is required for those APIs.
