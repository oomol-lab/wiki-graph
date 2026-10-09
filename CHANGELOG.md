# Changelog

## 0.8.2

- Expose the SDK host, search-mode, source-locator, URI, and storage types needed by Node and Electron hosts without importing `wiki-graph-core` directly.
- Add SDK archive search-session clearing and preserve callback-scoped managed archive reads.
- Fix FTS keyset pagination when a dense index is present but the query explicitly uses `fts`; hybrid cursors remain applied after RRF fusion.
- Add real-index pagination coverage for FTS, embedding, and hybrid queries.

### Migration from 0.8.1

Update `wiki-graph-core`, `wiki-graph-sdk`, and `wiki-graph` together to `0.8.2`. Consumers can import the newly exposed public types and URI helpers from `wiki-graph-sdk`; no direct Core import is required for those APIs.
