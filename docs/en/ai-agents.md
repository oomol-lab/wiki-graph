<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest knowledge-base archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge-base archive.

Do not treat `.sdpub` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive commands for archive state and URI-first object commands for exploration:

```bash
wikigraph wkg://book.sdpub/chapter/tree get --json
wikigraph wkg://book.sdpub search "keyword" --type source,summary,chunk,entity,triple
wikigraph wkg://book.sdpub/chapter/3/source/0#0..8 get
wikigraph <uri> related
wikigraph <uri> evidence
wikigraph <uri> pack --budget 5000
wikigraph wkg://book.sdpub index --json
```

When an agent has a URI and needs to know which operations are valid, use `wikigraph help object` or `wikigraph help object <object>`. When the operation is known but the valid targets are unclear, use `wikigraph help verb <verb>`. `wikigraph help matrix` provides the full object/verb cross-reference.

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `wkg://.../chapter/tree get --json` for a compact table-of-contents map, then choose likely chapter ids and expand them with scoped URI search or `wkg://... get`. Search mode uses `wkg://... search --type <kind>` for candidate discovery and falls back to source/summary/chunk text when structured objects do not match. Reading mode uses `wkg://... get` after the relevant source URI has been selected.
Search results may display short object URIs such as `wkg://entity/Q9957`; prepend the archive locator before reusing them in object commands, for example `wkg://book.sdpub/entity/Q9957`.

Choose a search lens explicitly: `--type chunk` for Reading Graph structure, `--type summary` for quick overview, `--type source` for original wording, or `--type entity,triple` for Knowledge Graph objects. Use scoped chapter URIs, `--limit`, and `--cursor` to keep retrieval bounded.

For evidence tracing, logic-chain reconstruction, or relationship analysis that starts from source text, use `wikigraph <uri> evidence` to return source ranges for a known object, then use `wikigraph <uri> related` or `wikigraph <uri> pack` to move back into nearby objects. Use source URIs when continuous prose is the goal.

`index` is useful when archive-level readiness or metadata matters: title, source format, chapter count, summary count, node count, and edge count. For content exploration after `chapter tree`, selecting a small set of chapter ids and using scoped chapter URIs usually spends less context than returning to archive-level entry points.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.sdpub`
- Creation sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: Wiki Graph URIs such as `wkg://source/chapter/1#0..3`, `wkg://chunk/42`, `wkg://entity/Q9957`, and `wkg://triple/...`
- Cheap operations: `index`, `search`, `get`, `related`, `evidence`, `pack`, `export`
- Expensive operations: Reading Graph, Reading Summary, or Knowledge Graph `queue add`
- Estimate first: `wikigraph <archive-uri> estimate --stage reading-summary`
- JSON: pass `--json` when composing with tools

## Recommended Execution Strategy

1. For content understanding, use `<archive-uri>/chapter/tree get --json` as the compact global map.
2. Select likely chapter ids from the tree, then search scoped chapter URIs before broad archive search.
3. Use `wikigraph <uri> search` to locate source, summary, chunk, entity, or triple objects.
4. Use `wikigraph <uri> get` to inspect one object.
5. Use `wikigraph <uri> evidence` when an object should be grounded back to source text.
6. Use `wikigraph <uri> related` to move to nearby peer objects.
7. Use `wikigraph <uri> pack` when the user needs deterministic context around a known object.
8. Use `export` only when the user needs a projection.
9. Use `index` when archive readiness, metadata, or build state is part of the task.
10. Before `queue add`, run `estimate`; if the estimate is too large for the session, ask the user.

## Queue Workflow

```bash
wikigraph wkg://book.sdpub create ./book.epub
wikigraph wkg://book.sdpub index
wikigraph wkg://book.sdpub estimate --stage reading-summary
wikigraph wkg://book.sdpub/chapter/3 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
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
