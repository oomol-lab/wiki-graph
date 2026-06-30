<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is URI-first. The primary object is a `.sdpub` knowledge-base archive, and CLI targets are Wiki Graph URIs.

```bash
wikigraph <wkg-uri> <action> ...
wikigraph wkg-job://<job-id> <action> ...
```

## Archive Commands

```bash
wikigraph <archive-uri> create [source] [--input-format <format>] [--llm <json>] [--prompt <text>]
wikigraph <archive-uri> estimate [--stage <source|reading-graph|reading-summary>] [--json]
wikigraph <archive-uri>/state get [--json]
wikigraph <located-wkg-uri> search <query> [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <located-wkg-uri>/<chapter|entity|triple|source|summary|chunk> search <query> [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <located-wkg-uri>/<chapter|entity|triple|source|summary|chunk> list [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <object-uri> get [--json|--jsonl]
wikigraph <object-uri> related [--evidence [n]] [--json|--jsonl]
wikigraph <entity|triple|summary|chunk-uri> evidence [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <located-chunk-uri|located-entity-uri|located-triple-uri> pack [--budget <chars>] [--json|--jsonl]
wikigraph <archive-uri> export --output-format <format> [--output <path>]
wikigraph <chapter-uri> queue add --task reading-graph|reading-summary|knowledge-graph --accept-cost [--boost] [--llm <json>] [--prompt <text>]
wikigraph wkg-job:// list [--all] [--active] [--input <archive-uri>] [--json]
wikigraph wkg-job://<job-id> get [--json]
wikigraph wkg-job://<job-id> watch [--jsonl] [--from beginning|now]
wikigraph wkg-job://<job-id> pause|resume|cancel|boost
wikigraph wkg-job://<job-id> set --task reading-graph|reading-summary|knowledge-graph
wikigraph queue clean
```

Exploration modes:

- Search mode: `search` discovers URI-addressable objects from query text.
- Structure mode: `<archive-uri>/chapter/tree get --json` shows table-of-contents hierarchy; `list` enumerates object collections from an archive or scoped URI.
- Reading mode: `get` opens one selected URI; `related`, `evidence`, and `pack` expand or verify it after selection.

Search and collection behavior:

- `search` finds URI-addressable objects from query text. Search results are leads, not source evidence.
- `list` enumerates URI-addressable objects without query text.
- Object commands use Wiki Graph URIs. Use an archive or scope URI such as `wkg:///Users/me/book.sdpub` for `search` and `list`; use a concrete object URI such as `wkg:///Users/me/book.sdpub/chapter/12` for `get`, `related`, or `evidence`. `pack` is limited to chunk, entity, and triple graph objects.
- For content understanding, choose a search lens in the URI: `<archive-uri>/chunk` for Reading Graph structure, `<archive-uri>/summary` for quick overview, `<archive-uri>/source` for original source wording, or `<archive-uri>/entity` and `<archive-uri>/triple` for Knowledge Graph objects.
- Use a chapter scope URI such as `wkg:///Users/me/book.sdpub/chapter/12` to keep search or list local to one chapter.
- `--limit` defaults to `20`; pass returned `nextCursor` back through `--cursor` for the next page.
- Search does not do semantic expansion, stemming, or vector search.
- Read `wikigraph help uri` for the URI grammar and object boundary rules.

## Build Stages

User-facing stages:

- `source`: imported normalized source data
- `reading-graph`: reading-oriented chunks, edges, and source-backed knowledge units
- `reading-summary`: readable chapter summaries
- `knowledge-graph`: grounded entity mentions and source-backed relations

`source` is cheap. Reading Graph, Reading Summary, and Knowledge Graph queue tasks may call an LLM provider. Run `estimate` first, then use `queue add` for the chapter ids you want to generate.

Queue behavior:

- `queue add` requires `--accept-cost`.
- `wkg-job:// list --json` prints a machine-readable snapshot.
- `wkg-job://<job-id> watch --jsonl` prints durable progress events and is the recommended agent-facing stream.

## Formats

Supported formats:

- `sdpub`
- `epub`
- `txt`
- `markdown`

Extension mapping:

- `.sdpub` -> `sdpub`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` or `.markdown` -> `markdown`

## JSON Contract

Read/search/navigation commands support `--json` for machine consumption:

```bash
wikigraph wkg:///Users/me/book.sdpub/chunk search "RAG" --json
wikigraph wkg:///Users/me/book.sdpub/chapter/3 get --json
```

Human-readable stdout is Markdown-like text with stable ids and suggested next commands.

## Direct Transform

`transform` runs a direct one-shot digest/export without creating a reusable `.sdpub` knowledge-base archive:

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

There is no bare transform shortcut. Use `wikigraph transform ...` explicitly.

## Maintenance Commands

Maintenance commands use URI targets:

```bash
wikigraph <archive-uri> get|set [metadata options]
wikigraph <cover-uri> get
wikigraph <archive-uri>/chapter list|add [options]
wikigraph <chapter-uri>/state get [--json]
wikigraph <chapter-uri> move|remove|reset [options]
wikigraph <chapter-uri>/source set [--input <path>] --input-format <format>
wikigraph <chapter-uri>/summary set [--input <path>]
wikigraph <chapter-uri>/title set (--title <title>|--clear)
wikigraph <archive-uri>/chapter/tree get|set [options]
```

Use URI-first commands for routine exploration. `<archive-uri>/chapter/tree get` is read-only structure inspection and prints a stable JSON tree with `title: null` for untitled chapters. `<archive-uri>/chapter/tree set` can reorder chapters and change titles when `title` is present.

`wikigraph config status` prints configuration status. `wikigraph <archive-uri>/state get` prints archive state.

## Standard Stream Rules

The URI-first `create` command writes `.sdpub` archives. It reads Markdown or plain text from stdin when `--input-format` is provided:

```bash
cat ./chapter.txt | wikigraph wkg://chapter.sdpub create --input-format txt
```

For direct stream digest/export, use `transform` explicitly:

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
