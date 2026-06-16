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
spinedigest find book.sdpub "keyword"
spinedigest page book.sdpub node:84
spinedigest evidence book.sdpub node:84
```

Use the library API only when the surrounding system explicitly needs in-process integration.

## Minimal Operational Contract

- Primary object: `.sdpub`
- Import sources: EPUB, Markdown, TXT, and text pipelines
- Read objects: `chapter:<id>`, `node:<id>`, `sentence:<serial>:<fragment>:<index>`, `summary:<id>`, `meta:book`
- Cheap operations: `status`, `index`, `ls`, `find`, `page`, `evidence`, `links`, `backlinks`, `map`, `export`
- Expensive operations: graph, summary, or ready `build`
- Estimate first: `spinedigest estimate <archive.sdpub> --stage ready`
- JSON: pass `--json` when composing with tools

## Recommended Execution Strategy

1. For an unknown archive, run `status` and `index`.
2. Use `find` or `ls` to discover stable object ids.
3. Use `page` to read one object.
4. Use `evidence` before quoting or making source-backed claims.
5. Use `links`, `backlinks`, `path`, or `map` to navigate graph context.
6. Use `export` only when the user needs a projection.
7. Before `build`, run `estimate`; if the estimate is too large for the session, ask the user.

## Build Workflow

```bash
spinedigest import book.sdpub ./book.epub
spinedigest status book.sdpub
spinedigest estimate book.sdpub --stage ready
spinedigest build book.sdpub --stage graph --chapter 3
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
