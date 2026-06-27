<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is archive-first. The primary object is a `.sdpub` knowledge-base archive, and the primary command shape is:

```bash
wikigraph <action> <archive.sdpub> ...
```

## Archive Commands

```bash
wikigraph create <archive.sdpub> [source] [--input-format <format>] [--llm <json>] [--prompt <text>] [--confirm]
wikigraph estimate <archive.sdpub> [--stage <source|reading-graph|reading-summary>] [--json]
wikigraph status <archive.sdpub> [--json]
wikigraph index <archive.sdpub> [--json]
wikigraph list <archive.sdpub> --type <types> [--id <ids>] [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph find <archive.sdpub> <query> --type <types> [--match <any|all>] [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph grep <archive.sdpub> <query> --type <types> [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph page <archive.sdpub> <selector> [--json]
wikigraph read <archive.sdpub> <selector>
wikigraph links <archive.sdpub> --node <id> [--json]
wikigraph backlinks <archive.sdpub> --node <id> [--json]
wikigraph related <archive.sdpub> --node <id> [--json]
wikigraph path <archive.sdpub> --from <id> --to <id> --chapter <id>
wikigraph map <archive.sdpub> [--json]
wikigraph pack <archive.sdpub> <selector> [--budget <chars>] [--json]
wikigraph export <archive.sdpub> --output-format <format> [--output <path>]
wikigraph queue add <archive.sdpub> --chapter <id> [--task reading-graph|reading-summary|knowledge-graph] --accept-cost [--boost] [--llm <json>] [--prompt <text>]
wikigraph queue list [--all] [--active] [--input <archive.sdpub>] [--json]
wikigraph queue status <job-id> [--json]
wikigraph queue watch <job-id> [--jsonl] [--from beginning|now]
wikigraph queue pause|resume|cancel|boost <job-id>
wikigraph queue target <job-id> --task reading-graph|reading-summary|knowledge-graph
wikigraph queue clean
```

Exploration modes:

- Search mode: `find` discovers objects by deterministic keywords; `grep` checks exact continuous text.
- Structure mode: `chapter tree --json` shows table-of-contents hierarchy; `list` shows chapter and knowledge-node collections; `page` opens one page and exposes related nodes, source fragments, and links.
- Reading mode: `read` prints continuous text for a selected chapter, knowledge node, summary, source fragment, or metadata object.

Search and collection behavior:

- `find` is deterministic keyword discovery. It splits the query on whitespace, defaults to `--match any`, and ranks objects that match more terms first.
- `--type` is required for `list`, `find`, and `grep`. For content understanding, choose a search lens: `--type node` for topology / LLM Wiki structure, `--type summary` for quick overview, or `--type fragment` for original source wording.
- `find --match all` is the strict mode where every keyword must appear in the same object.
- `grep` is exact text search. It treats the query as one continuous string.
- `--chapter 12` or `--chapter 11,12` limits results to chapters.
- `--type chapter,summary,node,fragment,meta` limits `list`; `find` and `grep` accept `--type summary,node,fragment` as search lenses.
- `--order doc-asc|doc-desc` sorts by stable document position. Default is `doc-asc`.
- `--limit` defaults to `20`; pass returned `nextCursor` back through `--cursor` for the next page.
- Neither command does semantic expansion, fuzzy matching, stemming, or vector search.

Object ids:

- `--chapter <id>`
- `--node <id>`
- `--fragment <chapter>:<fragment>`
- `--summary <id>`
- `--meta book`

## Build Stages

User-facing stages:

- `source`: imported normalized source data
- `reading-graph`: reading-oriented chunks, edges, and source-backed knowledge units
- `reading-summary`: readable chapter summaries

`source` is cheap. Reading Graph, Reading Summary, and Knowledge Graph queue tasks may call an LLM provider. Run `estimate` first, then use `queue add` for the chapter ids you want to generate.

Queue behavior:

- `queue add` requires `--accept-cost`.
- `queue list --json` prints a machine-readable snapshot.
- `queue watch --jsonl` prints durable progress events and is the recommended agent-facing stream.

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
wikigraph find book.sdpub "RAG" --type node --json
wikigraph page book.sdpub --chapter 3 --json
```

Human-readable stdout is Markdown-like text with stable ids and suggested next commands.

## Direct Transform

`transform` runs a direct one-shot digest/export without creating a reusable `.sdpub` knowledge-base archive:

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

There is no bare transform shortcut. Use `wikigraph transform ...` explicitly.

## Maintenance Commands

Archive maintenance commands are top-level commands:

```bash
wikigraph meta <archive.sdpub> [metadata options] [--json]
wikigraph cover <archive.sdpub>
wikigraph chapter <list|status|add|move|remove|reset|set-source|set-summary|set-title|tree> <path> [options]
```

Use archive-first commands for routine exploration. `chapter tree` without `apply` is read-only structure inspection and prints a stable JSON tree with `title: null` for untitled chapters. Maintenance commands are for metadata edits, cover extraction, and mutating chapter tree edits; `chapter tree apply` can reorder chapters and change titles when `title` is present.

`wikigraph config status` prints configuration status. `wikigraph status <archive.sdpub>` prints archive status.

## Standard Stream Rules

The archive-first `create` command writes `.sdpub` archives. It reads Markdown or plain text from stdin when `--input-format` is provided:

```bash
cat ./chapter.txt | wikigraph create ./chapter.sdpub --input-format txt
```

For direct stream digest/export, use `transform` explicitly:

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
