<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is archive-first. The primary command shape is:

```bash
spinedigest <action> <archive.sdpub> ...
```

## Archive Commands

```bash
spinedigest import <archive.sdpub> [source] [--input-format <format>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest build <archive.sdpub> [--stage <source|graph|summary|ready>] [--chapter <id>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest estimate <archive.sdpub> [--stage <source|graph|summary|ready>] [--json]
spinedigest status <archive.sdpub> [--json]
spinedigest index <archive.sdpub> [--json]
spinedigest list <archive.sdpub> [--id <ids>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest find <archive.sdpub> <query> [--match <any|all>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest grep <archive.sdpub> <query> [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest page <archive.sdpub> <id> [--json]
spinedigest read <archive.sdpub> <id>
spinedigest evidence <archive.sdpub> <id> [--json]
spinedigest links <archive.sdpub> <node:id> [--json]
spinedigest backlinks <archive.sdpub> <node:id> [--json]
spinedigest path <archive.sdpub> <node:id> <node:id> --chapter <id>
spinedigest export <archive.sdpub> --output-format <format> [--output <path>]
```

Exploration modes:

- Search mode: `find` discovers objects by deterministic keywords; `grep` checks exact continuous text.
- Structure mode: `list` returns bounded object collections; `page` opens one detailed object with local navigation.
- Reading mode: `read` prints one object as continuous plain text.

Search and collection behavior:

- `find` is deterministic keyword discovery. It splits the query on whitespace, defaults to `--match any`, and ranks objects that match more terms first.
- `find --match all` is the strict mode where every keyword must appear in the same object.
- `grep` is exact text search. It treats the query as one continuous string.
- `--chapter 12` or `--chapter 11,12` limits results to chapters.
- `--type chapter,summary,node,fragment,sentence,meta` limits `list`; `find` and `grep` search `summary,node,fragment,sentence`.
- `--order doc-asc|doc-desc` sorts by stable document position. Default is `doc-asc`.
- `--limit` defaults to `20`; pass returned `nextCursor` back through `--cursor` for the next page.
- Neither command does semantic expansion, fuzzy matching, stemming, or vector search.

Object ids:

- `chapter:<id>`
- `node:<id>`
- `fragment:<serial>:<fragment>`
- `sentence:<serial>:<fragment>:<index>`
- `summary:<id>`
- `meta:book`

## Build Stages

User-facing stages:

- `source`: imported normalized source data
- `graph`: graph nodes, edges, and evidence-backed knowledge units
- `summary`: readable chapter summaries
- `ready`: full ready archive projection

`source` is cheap. `graph`, `summary`, and `ready` may call an LLM provider. Run `estimate` first for full-archive builds.

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
spinedigest find book.sdpub "RAG" --json
spinedigest page book.sdpub node:84 --json
spinedigest evidence book.sdpub node:84 --json
```

Human-readable stdout is Markdown-like text with stable ids and suggested next commands.

## Compatibility Commands

The direct one-shot digest command remains available:

```bash
spinedigest transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--confirm] [--stage <planned|sourced|graphed|summarized>] [--verbose]
```

The low-level `.sdpub` maintenance family remains available:

```bash
spinedigest sdpub <subcommand> ...
spinedigest sdpub stage <pending|advance> <path> [options]
spinedigest sdpub chapter <list|status|add|remove|reset|set-source|set-summary> <path> [options]
spinedigest sdpub graph <status|log|show|grep|neighbors|blame|path> <path> --chapter <id> [options]
```

Use the top-level archive commands for routine exploration. The `sdpub ...` family exists for compatibility, metadata work, chapter editing, and lower-level maintenance.

`spinedigest config status` prints configuration status. `spinedigest status <archive.sdpub>` prints archive status.

## Standard Stream Rules

The archive-first `import` command writes `.sdpub` archives. For pure one-shot stream digest/export workflows, use `spinedigest transform`:

```bash
cat ./chapter.txt | spinedigest transform --input-format txt --output-format markdown
```

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
