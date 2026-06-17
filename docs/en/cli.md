<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is archive-first. The primary object is a `.sdpub` knowledge-base archive, and the primary command shape is:

```bash
spinedigest <action> <archive.sdpub> ...
```

## Archive Commands

```bash
spinedigest create <archive.sdpub> [source] [--input-format <format>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest build <archive.sdpub> [--stage <source|graph|summary>] [--chapter <id>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest estimate <archive.sdpub> [--stage <source|graph|summary>] [--json]
spinedigest status <archive.sdpub> [--json]
spinedigest index <archive.sdpub> [--json]
spinedigest list <archive.sdpub> [--id <ids>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest find <archive.sdpub> <query> [--match <any|all>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest grep <archive.sdpub> <query> [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest page <archive.sdpub> <id> [--json]
spinedigest read <archive.sdpub> <id>
spinedigest links <archive.sdpub> <node:id> [--json]
spinedigest backlinks <archive.sdpub> <node:id> [--json]
spinedigest related <archive.sdpub> <node:id> [--json]
spinedigest path <archive.sdpub> <node:id> <node:id> --chapter <id>
spinedigest map <archive.sdpub> [--json]
spinedigest pack <archive.sdpub> <id> [--budget <chars>] [--json]
spinedigest export <archive.sdpub> --output-format <format> [--output <path>]
```

Exploration modes:

- Search mode: `find` discovers objects by deterministic keywords; `grep` checks exact continuous text.
- Structure mode: `list` shows chapter and knowledge-node directories; `page` opens one page and exposes related nodes, source fragments, and links.
- Reading mode: `read` prints continuous text for a selected chapter, knowledge node, summary, source fragment, or metadata object.

Search and collection behavior:

- `find` is deterministic keyword discovery. It splits the query on whitespace, defaults to `--match any`, and ranks objects that match more terms first.
- Untyped `find` is broad candidate discovery. For content understanding, choose a search lens: `--type node` for topology / LLM Wiki structure, `--type summary` for quick overview, or `--type fragment` for original source wording.
- `find --match all` is the strict mode where every keyword must appear in the same object.
- `grep` is exact text search. It treats the query as one continuous string.
- `--chapter 12` or `--chapter 11,12` limits results to chapters.
- `--type chapter,summary,node,fragment,meta` limits `list`; `find` and `grep` accept `--type summary,node,fragment` as search lenses. Untyped search also checks metadata and chapter titles for broad candidate discovery.
- `--order doc-asc|doc-desc` sorts by stable document position. Default is `doc-asc`.
- `--limit` defaults to `20`; pass returned `nextCursor` back through `--cursor` for the next page.
- Neither command does semantic expansion, fuzzy matching, stemming, or vector search.

Object ids:

- `chapter:<id>`
- `node:<id>`
- `fragment:<serial>:<fragment>`
- `summary:<id>`
- `meta:book`

## Build Stages

User-facing stages:

- `source`: imported normalized source data
- `graph`: graph nodes, edges, and source-backed knowledge units
- `summary`: readable chapter summaries

`source` is cheap. `graph` and `summary` may call an LLM provider. Run `estimate` first for full-archive builds.

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
spinedigest find book.sdpub "RAG" --type node --json
spinedigest page book.sdpub chapter:3 --json
```

Human-readable stdout is Markdown-like text with stable ids and suggested next commands.

## Direct Transform

`transform` runs a direct one-shot digest/export without creating a reusable `.sdpub` knowledge-base archive:

```bash
spinedigest transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|graph|summary>] [--verbose]
```

There is no bare transform shortcut. Use `spinedigest transform ...` explicitly.

## Maintenance Commands

Archive maintenance commands are top-level commands:

```bash
spinedigest meta <archive.sdpub> [metadata options] [--json]
spinedigest cover <archive.sdpub>
spinedigest chapter <list|status|add|move|remove|reset|set-source|set-summary|set-title|tree> <path> [options]
```

Use archive-first commands for routine exploration. Maintenance commands are for metadata edits, cover extraction, and chapter tree edits. `chapter tree` prints a stable JSON tree with `title: null` for untitled chapters; `chapter tree apply` can reorder chapters and change titles when `title` is present.

`spinedigest config status` prints configuration status. `spinedigest status <archive.sdpub>` prints archive status.

## Standard Stream Rules

The archive-first `create` command writes `.sdpub` archives. It reads Markdown or plain text from stdin when `--input-format` is provided:

```bash
cat ./chapter.txt | spinedigest create ./chapter.sdpub --input-format txt
```

For direct stream digest/export, use `transform` explicitly:

```bash
cat ./chapter.txt | spinedigest transform --input-format txt --output-format markdown
```

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
