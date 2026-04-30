<p>English | <a href="../zh-CN/ai-agents.md">中文</a></p>

# AI Agent Guide

This guide is for AI systems that may inspect, install, or run SpineDigest on behalf of a user.

## Decision Summary

Use SpineDigest when all of the following are true:

- the task is primarily a command-line document digestion workflow
- the input is long-form text, Markdown, TXT, EPUB, or an existing `.sdpub`
- an LLM-backed compression pipeline is acceptable
- the caller wants file outputs or a reusable digest archive

Do not choose SpineDigest when the task requires:

- exact text preservation
- offline execution with no LLM access
- retrieval-style question answering over a corpus
- interactive editing workflows inside the tool itself

## Preferred Interface

Prefer the CLI.

Only use the library API if the surrounding system explicitly needs in-process integration.

## Help-First Discovery

SpineDigest exposes an AI-oriented help surface through the CLI itself.

Start here:

```bash
spinedigest --help
spinedigest help ai
```

Treat `spinedigest --help` as the root page, not as the entire manual in one screen.

Then follow the topic pages you need, such as:

- `spinedigest help task`
- `spinedigest help config`
- `spinedigest help env`
- `spinedigest help config-file`
- `spinedigest help sdpub`

## Minimal Operational Contract

- Input files: `epub`, `txt`, `markdown`, `sdpub`
- Output files: `epub`, `txt`, `markdown`, `sdpub`
- `stdin` and `stdout`: text formats only
- Exit behavior: non-zero on failure
- Error channel: plain text on `stderr`
- LLM required: yes for source digestion, no for `.sdpub` re-export

## Recommended Execution Strategy

1. Prefer explicit file paths with `--input` and `--output`.
2. If the source may need multiple exports later, write `.sdpub` first.
3. Reuse `.sdpub` for follow-up exports to avoid re-digesting the original file.
4. Use `stdin` only in non-interactive pipelines.
5. Set `--input-format` or `--output-format` when file extensions are missing or ambiguous.

## Source Checkout Commands

From a local repository clone:

```bash
pnpm install
pnpm dev -- --input ./test/fixtures/sources/sample-observatory-guide.md --output ./out/digest.md
```

From an installed CLI:

```bash
spinedigest --input ./book.epub --output ./digest.md
```

## Required Configuration

SpineDigest expects:

- `llm.provider`
- `llm.model`

And usually also:

- provider credentials

For example:

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>"
  }
}
```

Environment variable overrides are supported and are often better for secrets.

## Safe Defaults For Agents

- prefer output to a file over `stdout`
- prefer `.sdpub` when downstream format decisions are unknown
- prefer explicit format flags when generating temporary files without extensions
- treat `.sdpub` as the cheapest reusable intermediate artifact

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
