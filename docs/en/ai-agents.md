<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest knowledge-base archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge-base archive.

Do not treat `.sdpub` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive-first CLI commands:

```bash
spinedigest chapter tree book.sdpub --json
spinedigest list book.sdpub --type node --chapter 3,7,12
spinedigest find book.sdpub "keyword" --type fragment --chapter 3,7,12
spinedigest page book.sdpub fragment:3:4
spinedigest page book.sdpub node:84
spinedigest read book.sdpub chapter:12
spinedigest pack book.sdpub node:84 --budget 5000
```

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `chapter tree --json` for a compact table-of-contents map, then choose likely chapter ids and expand them with scoped `list --chapter <ids>` or `page chapter:<id>`. Search mode uses `find` for candidate discovery and `grep` for exact phrases. `find` defaults to `--match any`; use `--match all` only when every keyword must appear in the same object. Reading mode uses `read` after the relevant chapter, fragment, or node has been selected.

Untyped `find` is broad candidate discovery. For content understanding, choose a search lens: `--type node` for topology / LLM Wiki structure, `--type summary` for quick overview, or `--type fragment` for original source wording. Use `--chapter`, `--limit`, and `--cursor` to keep retrieval bounded.

For evidence tracing, logic-chain reconstruction, or relationship analysis that starts from source text, `page fragment:<id>` is often more useful than `read fragment:<id>` because it keeps the source text together with adjacent fragments and related node labels. Use `read chapter:<id>` or `read fragment:<id>` when continuous prose is the goal.

`index` is useful when archive-level readiness or metadata matters: title, source format, chapter count, summary count, node count, and edge count. For content exploration after `chapter tree`, selecting a small set of chapter ids and using scoped `list --chapter <ids>` usually spends less context than returning to archive-level entry points.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.sdpub`
- Creation sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: `chapter:<id>`, `node:<id>`, `fragment:<serial>:<fragment>`, `summary:<id>`, `meta:book`
- Cheap operations: `status`, `index`, `list`, `find`, `grep`, `page`, `read`, `links`, `backlinks`, `pack`, `export`
- Expensive operations: graph or summary `build`
- Estimate first: `spinedigest estimate <archive.sdpub> --stage summary`
- JSON: pass `--json` when composing with tools

## Recommended Execution Strategy

1. For content understanding, use `chapter tree --json` as the compact global map.
2. Select likely chapter ids from the tree, then use scoped `list --chapter <ids>` or `page chapter:<id>` before keyword search.
3. Inspect chapter `nodeGroups`, then use `page node:<id>` for relevant knowledge nodes.
4. Use `find` or `grep` to locate candidate chapters, verify missing concepts, or check exact source wording.
5. Use `page fragment:<id>` when source evidence should lead into related nodes or adjacent fragments.
6. Use `read` when the user needs prose rather than object navigation.
7. Use `links`, `backlinks`, or `path` to navigate graph context.
8. Use `pack` when the user needs deterministic context around a known object id.
9. Use `export` only when the user needs a projection.
10. Use `status` or `index` when archive readiness, metadata, or build state is part of the task.
11. Before `build`, run `estimate`; if the estimate is too large for the session, ask the user.

## Build Workflow

```bash
spinedigest create book.sdpub ./book.epub
spinedigest status book.sdpub
spinedigest estimate book.sdpub --stage summary
spinedigest build book.sdpub --stage graph --chapter 3 --confirm
```

Create/source is the safe first step. Graph and summary stages may call an LLM provider.

## Avoid

- Do not unzip `.sdpub` for routine retrieval.
- Do not inspect `database.db` unless building external tooling or debugging internals.
- Do not run a full-archive summary build just because a user asked a question about the archive.
- Do not present SpineDigest as a natural-language QA layer; the agent answers after reading archive context.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
