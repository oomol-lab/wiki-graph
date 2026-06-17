<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that inspect, build, or reuse SpineDigest archives on behalf of a user.

## Decision Summary

Use SpineDigest when the task involves long-form source material that should become a portable, CLI-readable knowledge archive.

Do not treat `.sdpub` as a ZIP payload for routine retrieval. Treat it as a managed LLM Wiki archive and use the CLI first.

## Preferred Interface

Prefer archive-first CLI commands:

```bash
spinedigest status book.sdpub
spinedigest index book.sdpub
spinedigest list book.sdpub --type chapter
spinedigest find book.sdpub "keyword" --type node
spinedigest page book.sdpub node:84
spinedigest read book.sdpub chapter:12
```

Use three exploration modes. For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `list --type chapter`, then `page chapter:<id>` and inspect `nodeGroups`. Search mode uses `find` for candidate discovery and `grep` for exact phrases. `find` defaults to `--match any`; use `--match all` only when every keyword must appear in the same object. Reading mode uses `read` after the relevant chapter, fragment, or node has been selected.

Untyped `find` is broad candidate discovery. For content understanding, choose a search lens: `--type node` for topology / LLM Wiki structure, `--type summary` for quick overview, or `--type fragment` for original source wording. Use `--chapter`, `--limit`, and `--cursor` to keep retrieval bounded.

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.sdpub`
- Import sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: `chapter:<id>`, `node:<id>`, `fragment:<serial>:<fragment>`, `summary:<id>`, `meta:book`
- Cheap operations: `status`, `index`, `list`, `find`, `grep`, `page`, `read`, `links`, `backlinks`, `export`
- Expensive operations: graph, summary, or ready `build`
- Estimate first: `spinedigest estimate <archive.sdpub> --stage ready`
- JSON: pass `--json` when composing with tools

## Recommended Execution Strategy

1. For an unknown archive, run `status` and `index`.
2. For understanding tasks, use `list --type chapter`, then `page chapter:<id>` before keyword search.
3. Inspect chapter `nodeGroups`, then use `page node:<id>` for relevant knowledge nodes.
4. Use `find` or `grep` to locate candidate chapters, verify missing concepts, or check exact source wording.
5. Use `read fragment:<id>` when the user needs original source prose after selecting a relevant node or chapter.
6. Use `links`, `backlinks`, or `path` to navigate graph context.
7. Use `export` only when the user needs a projection.
8. Before `build`, run `estimate`; if the estimate is too large for the session, ask the user.

## Build Workflow

```bash
spinedigest import book.sdpub ./book.epub
spinedigest status book.sdpub
spinedigest estimate book.sdpub --stage ready
spinedigest build book.sdpub --stage graph --chapter 3 --confirm
```

Import/source is the safe first step. Graph and summary stages may call an LLM provider.

## Avoid

- Do not unzip `.sdpub` for routine retrieval.
- Do not inspect `database.db` unless building external tooling or debugging internals.
- Do not run a full-archive ready build just because a user asked a question about the archive.
- Do not present SpineDigest as a natural-language QA layer; the agent answers after reading archive context.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
