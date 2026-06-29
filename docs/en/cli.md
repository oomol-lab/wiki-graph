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
wikigraph search <archive-or-scope-uri> <query> [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph list <archive-or-scope-uri> [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph get <object-uri> [--json|--jsonl]
wikigraph related <object-uri> [--json|--jsonl]
wikigraph evidence <object-uri> [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph pack <object-uri> [--budget <chars>] [--json|--jsonl]
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

- Search mode: `search` discovers URI-addressable objects from query text.
- Structure mode: `chapter tree --json` shows table-of-contents hierarchy; `list` enumerates object collections from an archive or scoped URI.
- Reading mode: `get` opens one selected URI; `related`, `evidence`, and `pack` expand or verify it after selection.

Search and collection behavior:

- `search` finds URI-addressable objects from query text. Search results are leads, not source evidence.
- `list` enumerates URI-addressable objects without query text.
- Object commands use Wiki Graph URIs. Convert archive paths to archive URIs such as `wikigraph:///Users/me/book.sdpub` before using `search`, `list`, `get`, `related`, `evidence`, or `pack`.
- For content understanding, choose a search lens: `--type chunk` for Reading Graph structure, `--type summary` for quick overview, `--type source` for original source wording, or `--type entity,triple` for Knowledge Graph objects.
- Use a chapter scope URI such as `wikigraph:///Users/me/book.sdpub/chapter/12` to keep search or list local to one chapter.
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
wikigraph search wikigraph:///Users/me/book.sdpub "RAG" --type chunk --json
wikigraph get wikigraph:///Users/me/book.sdpub/chapter/3 --json
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
