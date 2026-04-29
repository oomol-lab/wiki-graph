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

**Distill every book down to its spine**: SpineDigest feeds long-form books into an LLM pipeline and distills them into their essential content. The output isn't just a text summary — it also builds a chapter topology and a knowledge graph so the structure of the whole book is visible at a glance.

![Inkora screenshot](./docs/images/app-screenshot-en.png)

<div align=center>
  <sub><a href="http://inkora.oomol.com/download/sdpub">Inkora</a> opening a .sdpub file</sub>
</div>

## Install

Requirements:

- Node `>=22.12.0`
- For source digestion from EPUB, Markdown, or TXT: a supported LLM provider plus credentials
- For `.sdpub` re-export or `sdpub` inspection only: no LLM access required

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

The first two examples below create a new digest from source input, so they require LLM configuration first.
If you need config setup details, run:

```bash
spinedigest help config
```

Digest an EPUB into Markdown:

```bash
spinedigest --input ./book.epub --output ./digest.md --prompt "Preserve emotional shifts for both major and supporting characters."
```

Save a reusable archive first, then export later:

```bash
spinedigest --input ./book.epub --output ./book.sdpub
spinedigest --input ./book.sdpub --output ./book.epub
```

Pipe from stdin, receive on stdout:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
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

Every time SpineDigest finishes processing, it produces a `.sdpub` file. Think of it as a processed archive: it holds not just the summary text but the complete knowledge structure built along the way — chunks, snakes, the full concept graph.

With that archive on hand, you can export to EPUB, Markdown, or plain text any time without re-running the LLM pipeline. The trade-off: exported formats carry the text but lose the structural data. The chapter topology, snake connections, and knowledge graph live only inside `.sdpub`. If you might want to re-export later, or browse the book's structure in a visualization tool, keep the file around.

To open a `.sdpub` file, use **[Inkora](http://inkora.oomol.com/download/sdpub)** — a free app built specifically for it, with chapter topology and knowledge graph views.

For the internal layout and parser guidance, see the [format spec](./docs/sdpub.md).

## Inputs and Outputs

| Format             | Input | Output |
| ------------------ | ----- | ------ |
| `.epub`            | ✓     | ✓      |
| `.md`              | ✓     | ✓      |
| `.txt`             | ✓     | ✓      |
| `.sdpub`           | ✓     | ✓      |
| `stdin` (txt / md) | ✓     | —      |
| `stdout`           | —     | ✓      |

Requirements: Node `>=22.12.0` and a supported LLM provider with credentials. `.sdpub` input does not require LLM access.

## Library Usage

SpineDigest also exposes a programmatic API for embedding the pipeline in your own Node or TypeScript code. See [Library Usage](./docs/en/library.md).

## For AI Agents

SpineDigest's CLI-first design makes it easy to call directly, with no extra integration code.

- **Prefer the CLI.** Use the programmatic API only when code-level integration is explicitly required.
- **Use help as the discovery surface.** Start with `spinedigest --help`, then read `spinedigest help ai` and the relevant topic pages before guessing behavior.
- **Trust `--help`.** Every command in the CLI exposes usage guidance through `--help`.
- **Use explicit paths.** Pass `--input` and `--output` for deterministic, repeatable runs.
- **Check exit codes.** Success returns `0`; failure returns non-zero with a plain-text error on `stderr`.
- **stdin is narrow.** Only `txt` and `md` are accepted, and only in non-interactive flows.
- **No LLM needed for `.sdpub`.** Re-exporting an archive never calls an LLM provider.
- **Keep the archive.** If the same digest might need re-exporting, treat `.sdpub` as the intermediate artifact.

Useful help entry points:

```bash
spinedigest help ai
spinedigest help task
spinedigest help config
spinedigest help env
spinedigest help config-file
spinedigest help sdpub
```

Full agent guidance: [AI Agent Guide](./docs/en/ai-agents.md).
