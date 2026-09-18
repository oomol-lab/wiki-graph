# Wiki Graph Core

`wiki-graph-core` is the SDK package for [Wiki Graph](https://github.com/oomol-lab/wiki-graph), a long-text knowledge-base toolkit built around `.wikg` archives.

Use it when you want to integrate Wiki Graph archive, document, retrieval, and
library APIs directly instead of using the `wg` CLI. Core is written as
runtime-neutral TypeScript; the host supplies its own `File`/`Directory`
implementations and storage roots.

```bash
npm install wiki-graph-core
# or
pnpm add wiki-graph-core
```

The CLI package requires Node.js `>=22.12.0`. The core package itself does not
require Node and can be hosted by a browser, extension service, or another JS
runtime that implements the exported storage primitives.

Host `File` adapters support complete reads, byte-range readers, transactional
sequential writes, and positioned writes. See the SDK documentation for the
platform contract; ZIP and SQLite remain separate host providers.

For the CLI package, install [`wiki-graph`](https://www.npmjs.com/package/wiki-graph). For full documentation, examples, source code, and issue tracking, see the [GitHub repository](https://github.com/oomol-lab/wiki-graph).
