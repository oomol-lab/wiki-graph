<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is URI-first. The primary object is a `.wikg` knowledge-base archive, and CLI targets are Wiki Graph URIs.

```bash
wikigraph <wikg-uri> <action> ...
wikigraph wikg://local/job/<job-id> <action> ...
```

## Archive Commands

```bash
wikigraph <archive-uri> create [source] [--input-format <format>] [--llm <json>] [--prompt <text>]
wikigraph <archive-uri> inspect
wikigraph <chapter-uri> inspect
wikigraph <scope-uri> [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--backlinks] [--json|--jsonl]
wikigraph <scope-uri> --query <query> [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--backlinks] [--json|--jsonl]
wikigraph <object-uri> [--evidence [n]] [--context <n>] [--backlinks] [--json|--jsonl]
wikigraph <chunk-uri> related [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--json|--jsonl]
wikigraph <entity-uri> related [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--role <any|subject|object|self>] [--evidence [n]] [--json|--jsonl]
wikigraph <entity-uri|triple-uri|summary-uri|chunk-uri> evidence [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <located-chunk-uri|located-entity-uri> pack [--budget <chars>] [--json|--jsonl]
wikigraph <archive-uri> export --output-format <format> [--output <path>]
wikigraph <archive-uri>/index
wikigraph <archive-uri>/index build|embed|external|clear [--json]
wikigraph wikg://local/job add --input <chapter-uri> --task reading-graph|reading-summary|knowledge-graph --accept-cost [--boost] [--llm <json>] [--prompt <text>]
wikigraph wikg://local/job [--all] [--active] [--input <archive-uri>] [--json]
wikigraph wikg://local/job/<job-id> [--json]
wikigraph wikg://local/job/<job-id> watch [--jsonl] [--from beginning|now]
wikigraph wikg://local/job/<job-id> pause|resume|cancel|boost
wikigraph wikg://local/job/<job-id>/target set reading-graph|reading-summary|knowledge-graph
wikigraph wikg://local/job clean
```

Exploration modes:

- Search mode: `<scope-uri> --query <query>` discovers URI-addressable objects from query text.
- Structure mode: `<archive-uri>/chapter/tree` shows table-of-contents hierarchy; scope URIs enumerate object collections from an archive or scoped URI.
- Reading mode: passing one selected object URI opens it; `related`, `evidence`, and `pack` expand or verify it after selection.

Search and collection behavior:

- Scope URI `--query` finds URI-addressable objects from query text. Search results are leads, not source evidence.
- Search requires a current FTS index. If the index is missing or outdated, run `<archive-uri>/index build`; by default this creates a local cached FTS index instead of storing it in the archive.
- Optional `query` arguments on `evidence` and `related` also require the current FTS index.
- Scope URIs enumerate URI-addressable objects without query text.
- Object commands use Wiki Graph URIs. Use an archive or scope URI such as `wikg:///Users/me/book.wikg` for enumeration or query; use a concrete object URI such as `wikg:///Users/me/book.wikg/chapter/12` for reading or `evidence`. `related` and `pack` are limited to chunk and entity objects.
- For content understanding, choose a search lens in the URI: `<archive-uri>/chunk` for Reading Graph structure, `<archive-uri>/summary` for quick overview, `<archive-uri>/source` for original source wording, or `<archive-uri>/entity` and `<archive-uri>/triple` for Knowledge Graph objects.
- Lens position controls scope: use `<archive-uri>/entity` for an archive-wide entity inventory, and use `<chapter-uri>/entity` only when you need one chapter.
- For source passages mentioning or grounding a known entity, use `<archive-uri>/entity/<qid> evidence` before literal source search by label.
- For mapped Wikipedia pages, use `<archive-uri>/entity/<qid>/wikipage`; do not infer Wikipedia URLs from labels or QIDs.
- Use a chapter scope URI such as `wikg:///Users/me/book.wikg/chapter/12` to keep enumeration or query local to one chapter.
- Source search hits and evidence previews include 2 nearby sentences before and after by default. Use `--context 0` for exact matched or cited ranges, or `--context <n>` for a different nearby source window.
- Direct source reads such as `<chapter-uri>/source#23..25` remain exact.
- For scope, lens, pagination, and output format choices, read `wikigraph help retrieval`.
- Search does not do semantic expansion, stemming, or vector search.
- Read `wikigraph help uri` for the URI grammar and object boundary rules.

## Build Stages

User-facing stages:

- `source`: imported normalized source data
- `reading-graph`: reading-oriented chunks, edges, and source-backed knowledge units
- `reading-summary`: readable chapter summaries
- `knowledge-graph`: grounded entity mentions and source-backed relations

`source` is cheap. Reading Graph, Reading Summary, and Knowledge Graph jobs may call an LLM provider. Run `inspect` first, then use `wikg://local/job add` for the chapter ids you want to generate.

Generation job behavior:

- `wikg://local/job add` requires `--accept-cost`.
- `wikg://local/job --json` prints a machine-readable snapshot.
- `wikg://local/job/<job-id> watch --jsonl` prints durable progress events and is the recommended agent-facing stream.

## Formats

Supported formats:

- `wikg`
- `epub`
- `txt`
- `markdown`

Extension mapping:

- `.wikg` -> `wikg`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` or `.markdown` -> `markdown`

## Output Formats

Read/search/navigation commands support machine-readable output when the command usage lists `--json` or `--jsonl`:

```bash
wikigraph wikg:///Users/me/book.wikg/chunk --query "RAG"
wikigraph wikg:///Users/me/book.wikg/chapter/3
```

Human-readable stdout is Markdown-like text with stable ids and suggested next commands. Read `wikigraph help retrieval` before choosing `--json`, `--jsonl`, `--limit`, or `--all`.

## Direct Transform

`transform` runs a direct one-shot digest/export without creating a reusable `.wikg` knowledge-base archive:

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

There is no bare transform shortcut. Use `wikigraph transform ...` explicitly.

## Maintenance Commands

Maintenance commands use URI targets:

```bash
wikigraph <archive-uri> [metadata options]
wikigraph <archive-uri> set [metadata options]
wikigraph <cover-uri>
wikigraph <archive-uri>/chapter [--all] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <archive-uri>/chapter add [options]
wikigraph <chapter-uri>/state [--json]
wikigraph <chapter-uri> move|remove|reset [options]
wikigraph <chapter-uri>/source set [text] [--input <path>] --input-format <format>
wikigraph <chapter-uri>/summary set [text] [--input <path>]
wikigraph <chapter-uri>/title set <title>
wikigraph <chapter-uri>/title clear
wikigraph <archive-uri>/chapter/tree [options]
wikigraph <archive-uri>/chapter/tree set [options]
```

Use URI-first commands for routine exploration. `<archive-uri>/chapter/tree` is read-only structure inspection and prints a stable JSON tree with `title: null` for untitled chapters. `<archive-uri>/chapter/tree set` can reorder chapters and change titles when `title` is present.

`wikigraph config status` prints configuration status.

## Standard Stream Rules

The URI-first `create` command writes `.wikg` archives. It reads Markdown or plain text from stdin when `--input-format` is provided:

```bash
cat ./chapter.txt | wikigraph wikg://chapter.wikg create --input-format txt
```

For direct stream digest/export, use `transform` explicitly:

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
