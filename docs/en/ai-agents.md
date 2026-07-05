<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest knowledge-base archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge-base archive.

Do not treat `.wikg` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive commands for metadata and URI-first object commands for exploration:

```bash
wikigraph wikg://book.wikg/chapter/tree
wikigraph wikg://book.wikg/source --query "keyword"
wikigraph wikg://book.wikg/entity --query "keyword"
wikigraph wikg://book.wikg/chapter/3/source#0..8
wikigraph <uri> related
wikigraph <uri> evidence
wikigraph wikg://book.wikg/entity/Q9957 pack --budget 5000
wikigraph wikg://book.wikg/chapter
```

When an agent has a URI and needs to know which operations are valid, use `wikigraph <uri> --help`. For concrete predicate usage, use `wikigraph <uri> <predicate> --help`; predicates are not explained without a URI target.

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `wikg://.../chapter/tree` for a compact table-of-contents map, then choose likely chapter ids and expand them with scoped URI queries or direct URI reads. Search mode uses lens URIs such as `wikg://.../source --query <query>`, `wikg://.../chunk --query <query>`, or `wikg://.../entity --query <query>` for candidate discovery. Reading mode passes the relevant source URI directly.
Search results may display short object URIs such as `wikg://entity/Q9957`; prepend the archive locator before reusing them in object commands, for example `wikg://book.wikg/entity/Q9957`.

Choose a search lens explicitly in the URI: `/chunk` for Reading Graph structure, `/summary` for quick overview, `/source` for original wording, or `/entity` and `/triple` for Knowledge Graph objects. Lens position controls scope: use `<archive-uri>/entity` for an archive-wide entity inventory, and use `<chapter-uri>/entity` only when you need entities from one chapter. Use scoped chapter lens URIs such as `wikg://book.wikg/chapter/3/entity` to keep retrieval local.

When the user asks for source passages mentioning, grounding, or supporting a known entity, start from the entity URI: `<archive-uri>/entity/<qid> evidence`. Do not use source search by the entity label as the primary method; labels may have aliases, translations, variants, and grounded mentions that do not match the label text. Use source search only as a secondary literal-text check.

When investigating a known entity, chunk, or triple under a specific aspect, consider passing the aspect as the optional query to `evidence` first. Use `related` queries only for chunk and entity URIs. Both paths use the current FTS index to filter and rank candidates while keeping the current object anchor:

```bash
wikigraph <archive-uri>/entity/Q830077 evidence "objectivity"
wikigraph <archive-uri>/entity/Q830077 related "objectivity" --evidence 2
```

Use a scope URI without `--query` when recall or completeness matters more than narrowing. Read `wikigraph help retrieval` before choosing pagination or output format flags.

Source search hits and evidence previews include nearby source context by default. Use `--context 0` when exact cited ranges matter, and adjust `--context <n>` when a small source window is enough.

When investigating an entity, use this order: `<entity-uri>`, `<entity-uri> evidence`, `<entity-uri> related --evidence <n>`, then `<entity-uri>/wikipage`. Do not infer Wikipedia URLs from labels or Wikidata QIDs; use `/entity/<qid>/wikipage` for canonical mapped pages. Use external web search only if the mapped wikipage is missing or insufficient.

For evidence tracing, logic-chain reconstruction, or relationship analysis that starts from source text, use `wikigraph <uri> evidence` to return source ranges for a known object, then use `wikigraph <uri> related` or `wikigraph <graph-object-uri> pack` to move back into nearby graph objects. Use source URIs when continuous prose is the goal.

Use `<archive-uri>/chapter` when chapter readiness matters. Some chapters are structural table-of-contents nodes that organize child chapters; missing generated artifacts alone does not make them abnormal. For content exploration after `chapter tree`, selecting a small set of chapter ids and using scoped chapter URIs usually spends less context than returning to archive-level entry points.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.wikg`
- Creation sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: Wiki Graph URIs such as `wikg://chapter/1/source#0..3`, `wikg://chunk/42`, `wikg://entity/Q9957`, and `wikg://triple/...`
- Cheap operations: chapter scopes, chapter state reads, scope queries, direct reads, `related`, `evidence`, `pack`, and `export`
- Expensive operations: Reading Graph, Reading Summary, or Knowledge Graph `wikg://local/job add`
- Inspect first: `wikigraph <archive-uri> inspect`
- Retrieval strategy: use `wikigraph help retrieval` for scope, lens, pagination, and output format choices

## Recommended Execution Strategy

1. For content understanding, use `<archive-uri>/chapter/tree` as the compact global map.
2. Select likely chapter ids from the tree, then search scoped chapter URIs before broad archive search.
3. Use `wikigraph <scope-uri> --query <query>` to locate source, summary, chunk, entity, or triple objects.
4. Pass an object URI directly to inspect one object.
5. Use `<archive-uri>/entity/<qid> evidence` when a known entity should be grounded back to source text.
6. Use `wikigraph <uri> related` to move to nearby peer objects.
7. Use `<archive-uri>/entity/<qid>/wikipage` before external web search when investigating a known entity.
8. Use `wikigraph <graph-object-uri> pack` when the user needs deterministic context around a known chunk or entity.
9. Use `export` only when the user needs a projection.
10. Use `<archive-uri>/chapter` when chapter readiness or build state is part of the task.
11. Before `wikg://local/job add`, run `inspect`; if the planning cost is too large for the session, ask the user.

## Generation Job Workflow

```bash
wikigraph wikg://book.wikg create ./book.epub
wikigraph wikg://book.wikg/chapter
wikigraph wikg://book.wikg inspect
wikigraph wikg://local/job add --input wikg://book.wikg/chapter/3 --task reading-graph --accept-cost
wikigraph wikg://local/job/<job-id> watch --jsonl
```

Create/source is the safe first step. Reading Graph, Reading Summary, and Knowledge Graph tasks may call an LLM provider.

## Avoid

- Do not unzip `.wikg` for routine retrieval.
- Do not inspect `database.db` unless building external tooling or debugging internals.
- Do not start full-archive summary work just because a user asked a question about the archive.
- Do not present SpineDigest as a natural-language QA layer; the agent answers after reading archive context.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- The `.wikg` format spec
