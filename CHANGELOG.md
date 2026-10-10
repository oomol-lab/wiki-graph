# Changelog

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
