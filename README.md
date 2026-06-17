<div align=center>
  <h1>SpineDigest</h1>
  <p>English | <a href="./README_zh-CN.md">中文</a></p>
  <p>
    <a href="https://www.npmjs.com/package/spinedigest"><img alt="npm version" src="https://img.shields.io/npm/v/spinedigest"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

![SpineDigest Terminal Demo](./docs/images/terminal-en.png)

**SpineDigest builds portable LLM Wiki archives for AI agents.** It imports long-form sources into `.sdpub`, then lets agents search, browse, read source fragments, follow graph links, and export projections without unpacking the archive.

For agents, `.sdpub` exploration has three primary modes:

- **Search mode:** use `find` for whitespace-separated keyword discovery and `grep` for exact continuous text.
- **Structure mode:** use `list` for bounded object collections and `page` for one detailed object with local navigation.
- **Reading mode:** use `read` to print chapter, summary, fragment, or node text as continuous plain text.

For synthesis, timelines, relationship analysis, process reconstruction, or concept-structure tasks, start with Structure mode: `list --type chapter`, then `page chapter:<id>` and inspect `nodeGroups`. Use search to locate candidates or verify exact wording.

![Inkora screenshot](./docs/images/app-screenshot-en.png)

<div align=center>
  <sub><a href="http://inkora.oomol.com/download/sdpub">Inkora</a> opening a .sdpub file</sub>
</div>

## Install

Requirements:

- Node `>=22.12.0`
- For LLM-backed graph or summary builds: a supported LLM provider plus credentials
- For `.sdpub` search, reading, navigation, and export: no LLM access required

Try it without a global install:

```bash
npx spinedigest --help
```

Global install:

```bash
npm install -g spinedigest
```

To explore the CLI surface first, start with:

```bash
spinedigest --help
spinedigest help ai
```

## Quick Start

SpineDigest's primary object is `.sdpub`: a managed knowledge archive, not a one-off conversion output.

Import source material into an archive:

```bash
spinedigest import ./book.sdpub ./book.epub
cat ./article.md | spinedigest import ./article.sdpub --input-format markdown
```

Inspect the archive before expensive work:

```bash
spinedigest status ./book.sdpub
spinedigest index ./book.sdpub
spinedigest estimate ./book.sdpub --stage ready
```

Build derived knowledge when you intend to spend LLM time:

```bash
spinedigest build ./book.sdpub --stage graph --confirm
```

Search and read through the archive interface:

```bash
spinedigest list ./book.sdpub --type chapter
spinedigest find ./book.sdpub "RAG" --type node
spinedigest grep ./book.sdpub "exact source phrase"
spinedigest page ./book.sdpub node:84
spinedigest read ./book.sdpub chapter:12
spinedigest links ./book.sdpub node:84
spinedigest related ./book.sdpub node:84
spinedigest pack ./book.sdpub node:84 --budget 5000
```

Export a projection only when you need a portable view:

```bash
spinedigest export ./book.sdpub --output-format markdown --output ./digest.md
spinedigest export ./book.sdpub --output-format epub --output ./digest.epub
```

Cost rule:

```text
Import is cheap.
Estimate before build.
Build can be expensive.
Search, read, navigate, and export are cheap after build.
```

Full flag reference: [CLI Reference](./docs/en/cli.md).

## Why We Built This

People say you can't summarize a whole book with an LLM because the context window isn't long enough. But consider this: human short-term memory holds only 7±2 items (Miller's Law) — far shorter than any LLM context window. Humans still manage to read entire books and write summaries.

The bottleneck isn't the window. It's knowing what to cut.

A good summary can't preserve everything, and deciding what to drop is harder than deciding what to keep. There's no universal standard for what matters, either. It depends entirely on why you're reading: "What practical advice does the author give?", "What's the central argument?", "How does the protagonist change?" Each purpose leads to completely different trade-offs. Ask an AI to summarize without any direction and it genuinely doesn't know how — there's no single right answer that works for everyone.

SpineDigest solves this with a staged pipeline.

First, an LLM reads the source text section by section, simulating the way human attention is drawn to key ideas. It extracts a set of [chunks](<https://en.wikipedia.org/wiki/Chunking_(psychology)>) — the term cognitive psychology uses for discrete units of information in working memory. Each chunk is an attention landing point: one independent knowledge unit from the original text.

Next, the pipeline hands off to a classical algorithm. I build a knowledge graph with chunks as nodes, connect them by conceptual relevance, then use graph traversal and community detection to cluster the semantically related ones together. Each cluster is serialized in original reading order into what I call a snake — a threaded knowledge chain that winds through the source text, linking related ideas end to end.

Finally, the summarization phase switches back to LLMs, using an adversarial Multi-Agent framework with two roles: a respondent who writes the summary, and a panel of professors who challenge it.

**Every professor holds a snake.**

Picture a dissertation defense. The respondent stands at the front. The professors sit around the table, each holding a section of the original text, each measuring the draft against your stated extraction goal. They take turns: you missed this point, you didn't give that passage fair treatment. The respondent has to answer every challenge — they can't fully ignore anyone, but they can't fully satisfy everyone either. After several rounds, the final summary is the result of that pressure: a forced compromise where every part of the source gets some representation, even if it's just a sentence, and nothing is erased entirely.

![SpineDigest architecture](./docs/images/flowchart.svg)

Your intent runs through the whole pipeline. During the reading phase, the AI's attention is already shaped by what you told it to care about — your interests determine where the chunks land. During the defense phase, the professors apply that same goal as their evaluation standard. Content that aligns with your stated purpose gets protected by multiple professors at once; content that doesn't loses its advocates and gets pushed out under sustained pressure. The one sentence you wrote at the start keeps working at both ends.

## The `.sdpub` Format

`.sdpub` is the core SpineDigest knowledge archive. It holds source-derived structure, chapter-like pages, graph nodes, source fragment pointers, summaries, and metadata that the CLI can expose as an Agent-readable LLM Wiki.

With that archive on hand, agents can search and navigate the knowledge structure directly:

```bash
spinedigest index ./book.sdpub
spinedigest list ./book.sdpub --type chapter
spinedigest list ./book.sdpub --type node --chapter 12
spinedigest find ./book.sdpub "central argument" --type node
spinedigest page ./book.sdpub chapter:12
spinedigest read ./book.sdpub chapter:12
```

Markdown, EPUB, txt, and JSON-style outputs are projections of the archive. They are useful for portability, but they do not replace the `.sdpub` object when graph links and source fragments matter.

To open a `.sdpub` file, use **[Inkora](http://inkora.oomol.com/download/sdpub)** — a free app built specifically for it, with chapter topology and knowledge graph views.

For the internal layout and parser guidance, see the [format spec](./docs/sdpub.md).

## Inputs and Outputs

| Format             | Import Source | Export Projection |
| ------------------ | ------------- | ----------------- |
| `.epub`            | ✓             | ✓                 |
| `.md`              | ✓             | ✓                 |
| `.txt`             | ✓             | ✓                 |
| `.sdpub`           | archive       | archive           |
| `stdin` (txt / md) | compatibility | —                 |
| `stdout`           | —             | ✓                 |

Requirements: Node `>=22.12.0`. LLM credentials are required for graph and summary builds, not for `.sdpub` inspection, search, reading, navigation, or export.

## Library Usage

SpineDigest also exposes a programmatic API for embedding the pipeline in your own Node or TypeScript code. See [Library Usage](./docs/en/library.md).

## Related Projects

- [PDF Craft](https://github.com/oomol-lab/pdf-craft): If your source material is a scanned PDF, PDF Craft can convert it into EPUB or Markdown before you feed it into SpineDigest.
- [EPUB Translator](https://github.com/oomol-lab/epub-translator): If your goal is bilingual reading rather than summarization, EPUB Translator turns an EPUB into a bilingual edition while preserving the original layout.

## For AI Agents

SpineDigest's CLI-first design exposes `.sdpub` as a managed LLM Wiki archive.

- **Treat `.sdpub` as the primary object.** Use archive commands before unpacking or inspecting internals.
- **Choose an exploration mode first.** For synthesis and structural understanding, start with `list/page`; use `find/grep` for candidate discovery and exact wording; use `read` for continuous prose after selecting the relevant object.
- **Use help as the discovery surface.** Start with `spinedigest --help` as the root page, then follow `spinedigest help ai`, topic pages, or command-specific `--help` before guessing behavior.
- **Prefer `--json`.** Use it when composing with tools.
- **Estimate before build.** Do not run full-archive graph, summary, or ready builds without `spinedigest estimate`.
- **Check exit codes.** Success returns `0`; failure returns non-zero with a plain-text error on `stderr`.
- **Do not inspect `database.db` routinely.** Use `list`, `page`, `read`, and graph navigation commands instead.

Useful help entry points:

```bash
spinedigest help ai
spinedigest help task
spinedigest help config
spinedigest help env
spinedigest help config-file
spinedigest help command
```

Full agent guidance: [AI Agent Guide](./docs/en/ai-agents.md).
