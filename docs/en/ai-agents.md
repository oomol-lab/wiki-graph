<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest knowledge-base archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge-base archive.

Do not treat `.sdpub` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive-first CLI commands:

```bash
wikigraph chapter tree book.sdpub --json
wikigraph search book.sdpub "keyword" --type source,summary,chunk,entity,triple --chapter 3,7,12
wikigraph get book.sdpub wikigraph://source/chapter/3#0..8
wikigraph related book.sdpub <uri>
wikigraph evidence book.sdpub <uri>
wikigraph pack book.sdpub <uri> --budget 5000
wikigraph index book.sdpub --json
```

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `chapter tree --json` for a compact table-of-contents map, then choose likely chapter ids and expand them with scoped `search --chapter <ids>` or `get <uri>`. Search mode uses `search --type <kind>` for candidate discovery and falls back to source/summary/chunk text when structured objects do not match. Reading mode uses `get wikigraph://source/...` after the relevant source URI has been selected.

Choose a search lens explicitly: `--type chunk` for Reading Graph structure, `--type summary` for quick overview, `--type source` for original wording, or `--type entity,triple` for Knowledge Graph objects. Use `--chapter`, `--limit`, and `--cursor` to keep retrieval bounded.

For evidence tracing, logic-chain reconstruction, or relationship analysis that starts from source text, use `evidence <uri>` to return source ranges for a known object, then use `related <uri>` or `pack <uri>` to move back into nearby objects. Use source URIs when continuous prose is the goal.

`index` is useful when archive-level readiness or metadata matters: title, source format, chapter count, summary count, node count, and edge count. For content exploration after `chapter tree`, selecting a small set of chapter ids and using scoped `search --chapter <ids>` usually spends less context than returning to archive-level entry points.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.sdpub`
- Creation sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: Wiki Graph URIs such as `wikigraph://source/chapter/1#0..3`, `wikigraph://chunk/42`, `wikigraph://entity/Q9957`, and `wikigraph://triple/...`
- Cheap operations: `index`, `search`, `get`, `related`, `evidence`, `pack`, `export`
- Expensive operations: Reading Graph, Reading Summary, or Knowledge Graph `queue add`
- Estimate first: `wikigraph estimate <archive.sdpub> --stage reading-summary`
- JSON: pass `--json` when composing with tools

## Recommended Execution Strategy

1. For content understanding, use `chapter tree --json` as the compact global map.
2. Select likely chapter ids from the tree, then use scoped `search --chapter <ids>` before broad search.
3. Use `search` to locate source, summary, chunk, entity, or triple objects.
4. Use `get <uri>` to inspect one object.
5. Use `evidence <uri>` when an object should be grounded back to source text.
6. Use `related <uri>` to move to nearby peer objects.
7. Use `pack <uri>` when the user needs deterministic context around a known object.
8. Use `export` only when the user needs a projection.
9. Use `index` when archive readiness, metadata, or build state is part of the task.
10. Before `queue add`, run `estimate`; if the estimate is too large for the session, ask the user.

## Queue Workflow

```bash
wikigraph create book.sdpub ./book.epub
wikigraph index book.sdpub
wikigraph estimate book.sdpub --stage reading-summary
wikigraph queue add book.sdpub --chapter 3 --task reading-graph --accept-cost
wikigraph queue watch <job-id> --jsonl
```

Create/source is the safe first step. Reading Graph, Reading Summary, and Knowledge Graph tasks may call an LLM provider.

## Avoid

- Do not unzip `.sdpub` for routine retrieval.
- Do not inspect `database.db` unless building external tooling or debugging internals.
- Do not queue full-archive summary work just because a user asked a question about the archive.
- Do not present SpineDigest as a natural-language QA layer; the agent answers after reading archive context.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
