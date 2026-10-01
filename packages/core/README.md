# Wiki Graph Core

`wiki-graph-core` is the runtime-neutral engine for [Wiki Graph](https://github.com/oomol-lab/wiki-graph), a long-text knowledge-base toolkit built around `.wikg` archives.

Use it to embed archive, document, and retrieval primitives in any JavaScript
host. Core does not provide CLI commands, local configuration discovery, or
Node filesystem defaults. The host supplies its own `File`/`Directory`
implementations and storage roots.

```bash
npm install wiki-graph-core
# or
pnpm add wiki-graph-core
```

The core package does not require Node and can be hosted by a browser,
extension service, or another JS runtime that implements the exported storage
primitives. Node applications that want the complete programmatic equivalent
of the CLI should install `wiki-graph-sdk` instead.

Host `File` adapters support complete reads, byte-range readers, transactional
sequential writes, and positioned writes. ZIP and SQLite remain separate host
providers.

For the CLI package, install [`wiki-graph`](https://www.npmjs.com/package/wiki-graph). For full documentation, examples, source code, and issue tracking, see the [GitHub repository](https://github.com/oomol-lab/wiki-graph).
