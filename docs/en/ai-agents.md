<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest knowledge-base archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge-base archive.

Do not treat `.wikg` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive commands for metadata and URI-first object commands for exploration:

```bash
wikigraph wkg://book.wikg/chapter/tree get
wikigraph wkg://book.wikg/source search "keyword"
wikigraph wkg://book.wikg/entity search "keyword"
wikigraph wkg://book.wikg/chapter/3/source#0..8 get
wikigraph <uri> related
wikigraph <uri> evidence
wikigraph wkg://book.wikg/entity/Q9957 pack --budget 5000
wikigraph wkg://book.wikg/chapter list
```

When an agent has a URI and needs to know which operations are valid, use `wikigraph help object` or `wikigraph help object <object>`. When the operation is known but the valid targets are unclear, use `wikigraph help verb <verb>`. `wikigraph help matrix` provides the full object/verb cross-reference.

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `wkg://.../chapter/tree get` for a compact table-of-contents map, then choose likely chapter ids and expand them with scoped URI search or `wkg://... get`. Search mode uses lens URIs such as `wkg://.../source search <query>`, `wkg://.../chunk search <query>`, or `wkg://.../entity search <query>` for candidate discovery. Reading mode uses `wkg://... get` after the relevant source URI has been selected.
Search results may display short object URIs such as `wkg://entity/Q9957`; prepend the archive locator before reusing them in object commands, for example `wkg://book.wikg/entity/Q9957`.

Choose a search lens explicitly in the URI: `/chunk` for Reading Graph structure, `/summary` for quick overview, `/source` for original wording, or `/entity` and `/triple` for Knowledge Graph objects. Lens position controls scope: use `<archive-uri>/entity list` for an archive-wide entity inventory, and use `<chapter-uri>/entity list` only when you need entities from one chapter. Use scoped chapter lens URIs such as `wkg://book.wikg/chapter/3/entity` to keep retrieval local.

When the user asks for source passages mentioning, grounding, or supporting a known entity, start from the entity URI: `<archive-uri>/entity/<qid> evidence`. Do not use source search by the entity label as the primary method; labels may have aliases, translations, variants, and grounded mentions that do not match the label text. Use source search only as a secondary literal-text check.

When investigating a known entity, chunk, or triple under a specific aspect, consider passing the aspect as the optional query to `evidence` or `related` first. This filters and re-ranks candidates while keeping the current object anchor:

```bash
wikigraph <archive-uri>/entity/Q830077 evidence "objectivity"
wikigraph <archive-uri>/entity/Q830077 related "objectivity" --evidence 2
```

Use `list` when recall or completeness matters more than narrowing. Read `wikigraph help retrieval` before choosing pagination or output format flags.

Source search hits and evidence previews include nearby source context by default. Use `--context 0` when exact cited ranges matter, and adjust `--context <n>` when a small source window is enough.

When investigating an entity, use this order: `<entity-uri> get`, `<entity-uri> evidence`, `<entity-uri> related --evidence <n>`, then `<entity-uri>/wikipage get`. Do not infer Wikipedia URLs from labels or Wikidata QIDs; use `/entity/<qid>/wikipage get` for canonical mapped pages. Use external web search only if the mapped wikipage is missing or insufficient.

For evidence tracing, logic-chain reconstruction, or relationship analysis that starts from source text, use `wikigraph <uri> evidence` to return source ranges for a known object, then use `wikigraph <uri> related` or `wikigraph <graph-object-uri> pack` to move back into nearby graph objects. Use source URIs when continuous prose is the goal.

Use `<archive-uri>/chapter list` when chapter readiness matters. Some chapters are structural table-of-contents nodes that organize child chapters; missing generated artifacts alone does not make them abnormal. For content exploration after `chapter tree`, selecting a small set of chapter ids and using scoped chapter URIs usually spends less context than returning to archive-level entry points.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.wikg`
- Creation sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: Wiki Graph URIs such as `wkg://chapter/1/source#0..3`, `wkg://chunk/42`, `wkg://entity/Q9957`, and `wkg://triple/...`
- Cheap operations: `chapter list`, `<chapter-uri>/state get`, `search`, `get`, `related`, `evidence`, `pack`, `export`
- Expensive operations: Reading Graph, Reading Summary, or Knowledge Graph `queue add`
- Estimate first: `wikigraph <archive-uri> estimate --stage reading-summary`
- Retrieval strategy: use `wikigraph help retrieval` for scope, lens, pagination, and output format choices

## Recommended Execution Strategy

1. For content understanding, use `<archive-uri>/chapter/tree get` as the compact global map.
2. Select likely chapter ids from the tree, then search scoped chapter URIs before broad archive search.
3. Use `wikigraph <uri> search` to locate source, summary, chunk, entity, or triple objects.
4. Use `wikigraph <uri> get` to inspect one object.
5. Use `<archive-uri>/entity/<qid> evidence` when a known entity should be grounded back to source text.
6. Use `wikigraph <uri> related` to move to nearby peer objects.
7. Use `<archive-uri>/entity/<qid>/wikipage get` before external web search when investigating a known entity.
8. Use `wikigraph <graph-object-uri> pack` when the user needs deterministic context around a known chunk or entity.
9. Use `export` only when the user needs a projection.
10. Use `<archive-uri>/chapter list` when chapter readiness or build state is part of the task.
11. Before `queue add`, run `estimate`; if the estimate is too large for the session, ask the user.

## Queue Workflow

```bash
wikigraph wkg://book.wikg create ./book.epub
wikigraph wkg://book.wikg/chapter list
wikigraph wkg://book.wikg estimate --stage reading-summary
wikigraph wkg://book.wikg/chapter/3 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
```

Create/source is the safe first step. Reading Graph, Reading Summary, and Knowledge Graph tasks may call an LLM provider.

## Avoid

- Do not unzip `.wikg` for routine retrieval.
- Do not inspect `database.db` unless building external tooling or debugging internals.
- Do not queue full-archive summary work just because a user asked a question about the archive.
- Do not present SpineDigest as a natural-language QA layer; the agent answers after reading archive context.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- The `.wikg` format spec
