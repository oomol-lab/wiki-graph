<div align=center>
  <h1>SpineDigest</h1>
  <p>English | <a href="./README_zh-CN.md">中文</a></p>
  <p>
    <a href="https://www.npmjs.com/package/wikigraph"><img alt="npm version" src="https://img.shields.io/npm/v/wikigraph"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

![SpineDigest Terminal Demo](./docs/images/terminal-en.png)

**SpineDigest is a knowledge-base CLI optimized for AI agents.** It imports EPUB, Markdown, and plain text into `.wikg`, can use LLMs to extract knowledge graphs and summaries, then exposes the archive as a searchable, browsable, readable, source-backed, graph-navigable, context-packable [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

It is not a one-shot book-to-summary converter. Summaries, EPUB, Markdown, and JSON output are projections of the `.wikg` knowledge archive. The primary object is `.wikg` itself: a portable knowledge archive that can be built, maintained, searched, and reused.

There are three main ways to explore a `.wikg` archive:

- **Search mode:** use scope URIs with `--query` to discover URI-addressable source, summary, chunk, entity, and triple objects.
- **Structure mode:** use `wikg://.../chapter/tree --json` for the table-of-contents hierarchy, then use scope URIs directly or with `--query` to inspect local object collections.
- **Reading mode:** pass source, chapter, summary, chunk, entity, or triple URIs directly after selecting the relevant object.

Together, these modes let long documents behave like navigable knowledge bases: start with structure, locate relevant content, then return to source text and knowledge nodes for deeper reading.

![Inkora screenshot](./docs/images/app-screenshot-en.png)

<div align=center>
  <sub><a href="http://inkora.oomol.com/download/wikg">Inkora</a> opening a .wikg file</sub>
</div>

## Install

Requirements:

- Node `>=22.12.0`
- For LLM-backed Reading Graph, Reading Summary, or Knowledge Graph jobs: a supported LLM provider plus credentials
- For `.wikg` search, reading, navigation, and export: no LLM access required

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
wikigraph --help
wikigraph help overview
wikigraph help ai
```

## Quick Start

SpineDigest's primary object is `.wikg`: a CLI-managed knowledge-base archive, not a one-off export result.

Create a knowledge base from source material:

```bash
wikigraph wikg://book.wikg create ./book.epub
cat ./article.md | wikigraph wikg://article.wikg create --input-format markdown
```

Inspect before expensive work:

```bash
wikigraph wikg://book.wikg/state
wikigraph wikg://book.wikg/chapter/tree --json
wikigraph wikg://book.wikg inspect
```

Build derived knowledge when you intend to spend LLM time:

```bash
wikigraph wikg://local/job add --input wikg://book.wikg/chapter/12 --task reading-graph --accept-cost
wikigraph wikg://local/job/<job-id> watch --jsonl
```

Search, browse, and read through the knowledge-base interface:

```bash
wikigraph wikg://book.wikg/chapter/tree --json
wikigraph wikg://book.wikg/chunk --query "RAG"
wikigraph wikg://book.wikg/chapter/12/source --query "exact source phrase"
wikigraph wikg://book.wikg/chapter/12
wikigraph wikg://book.wikg/chunk/84
wikigraph wikg://book.wikg/chunk/84 related
wikigraph wikg://book.wikg/chunk/84 evidence
wikigraph wikg://book.wikg/chunk/84 pack --budget 5000
```

Output a projection only when you need a portable view. For example, read one chapter into Markdown text, or export the full archive as an EPUB:

```bash
wikigraph wikg://book.wikg/chapter/12/source > ./chapter-12.md
wikigraph wikg://book.wikg export --output-format epub --output ./digest.epub
```

Cost rule:

```text
Create is cheap.
Inspect before starting Reading Graph, Reading Summary, or Knowledge Graph jobs.
Start Reading Graph, Reading Summary, or Knowledge Graph jobs only when the cost and wait time are acceptable.
Search, read, related, evidence, pack, and export are cheap after build.
```

Full flag reference: [CLI Reference](./docs/en/cli.md).

## Why We Built This

Knowledge bases are useful for long documents because they turn material into a structure you can re-enter: inspect the table of contents, find concepts, and return to evidence instead of stuffing everything into one context window. The problem is that knowledge bases usually require people to define page boundaries, concept relationships, and source references. Books are the most familiar long documents; if we can Wiki-ify a book, EPUB, Markdown, and plain text can enter the same knowledge-base workflow.

That is why SpineDigest started with the problem of whole books. People often say an LLM cannot really read a whole book because the context window is not long enough. But human short-term memory holds only 7 +/- 2 items ([Miller's Law](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two)), far less than any modern LLM context window. Humans still read whole books, move back and forth with questions, build structures in their heads, and answer from those structures.

The bottleneck is not just window size. It is how working memory is organized.

If you put a whole book directly into context, what you get is a very long text stream. It can be summarized on the fly, searched by keyword, or sliced into excerpts, but it is hard to answer stable structural questions: which concepts belong together, where a claim came from, how two chapters relate, and which source passages support a knowledge point. Longer context does not make those problems disappear. It makes structure more necessary.

SpineDigest's goal is to turn long documents into external working memory.

First, an LLM reads the source text section by section, simulating how human attention is drawn to important ideas. It extracts a set of [chunks](<https://en.wikipedia.org/wiki/Chunking_(psychology)>). A chunk is not the final summary; it is an attention landing point, an independent knowledge unit that can be cited, traced, and recombined later.

Next, a classical algorithm takes over. I build a knowledge graph with chunks as nodes, connect them by conceptual relevance, then use graph traversal and community detection to cluster semantically related chunks. Each cluster is serialized in original reading order into what I call a snake: a knowledge chain that moves through the source text and links dispersed but related ideas.

Finally, the LLM returns to work on that structure. The old use case compressed those structures into a summary; the more important use now is to save them into `.wikg`. Later, you can use it like a Wiki: open chapter and chunk objects, trace source evidence, follow related objects, and pack an evidence-bounded context before answering.

**Every professor holds a snake.**

Picture a dissertation defense. The respondent stands at the front. The professors sit around the table. Each professor holds one knowledge chain and keeps reminding the respondent: this has evidence, that has a relationship, and this concept should not be mixed with that one. In the old story, the endpoint was a fairer summary. Now, the endpoint is a reference room you can enter again and again. You do not need to remember the whole book at once; you can call the relevant professors back, follow their chains to the evidence, and then compose your answer.

![SpineDigest architecture](./docs/images/flowchart.svg)

Your intent still runs through the whole process. During build, the prompt influences which knowledge units receive attention. During retrieval, the task decides whether to inspect structure first, search keywords first, or read source fragments first. The same `.wikg` can serve different questions: a timeline today, a concept map tomorrow, a writing context pack later. The knowledge base is not a one-shot answer. It is an interface for repeated reading, locating, and reuse.

## The `.wikg` Format

`.wikg` is the core SpineDigest knowledge-base archive. It holds source-derived chapter pages, graph nodes, evidence pointers, summaries, and metadata, then exposes them through the CLI as an LLM Wiki.

With that archive on hand, you can search and navigate the knowledge structure directly:

```bash
wikigraph wikg://book.wikg/chapter/tree --json
wikigraph wikg://book.wikg/chapter/12/chunk
wikigraph wikg://book.wikg/chunk --query "central argument"
wikigraph wikg://book.wikg/chapter/12
wikigraph wikg://book.wikg/chapter/12/source
```

Markdown, EPUB, txt, and JSON-style outputs are projections of the archive. They are useful for portability and reading, but they do not replace the `.wikg` object when graph links and source fragments matter.

To open a `.wikg` file, use **[Inkora](http://inkora.oomol.com/download/wikg)**. It is a free app built specifically for `.wikg`, with chapter topology and knowledge graph views.

The internal layout and parser guidance live in the format spec.

## Direct Transform

If you only need a one-shot digest or format conversion, use `transform`. It does not leave a reusable `.wikg` knowledge base unless you explicitly choose `--output-format wikg`.

```bash
cat chapter.txt | wikigraph transform --input-format txt --output-format markdown
wikigraph transform --input book.epub --output digest.md --output-format markdown
```

This mode is for pure conversion tasks. If the material will later be searched, navigated, traced to evidence, or built further, create a `.wikg` archive first.

## Library Usage

SpineDigest also exposes a programmatic API for embedding lower-level import, build, and export flows in your own Node or TypeScript code. The CLI is still the most complete knowledge-base interface. See [Library Usage](./docs/en/library.md) for non-CLI integration.

## Related Projects

- [PDF Craft](https://github.com/oomol-lab/pdf-craft): If your source material is a scanned PDF, PDF Craft can convert it into EPUB or Markdown before you import it into a SpineDigest knowledge base.
- [EPUB Translator](https://github.com/oomol-lab/epub-translator): If your goal is bilingual reading rather than building a knowledge base, EPUB Translator turns an EPUB into a bilingual edition while preserving the original layout.

## For AI Agents

SpineDigest's CLI-first design exposes `.wikg` as a managed LLM Wiki archive.

- **Treat `.wikg` as the primary object.** Use archive commands before unpacking or inspecting internals.
- **Choose an exploration mode first.** For synthesis and structural understanding, start with `wikg://.../chapter/tree --json`; use scope URIs with `--query` for candidate discovery and exact wording; pass a selected URI directly for continuous prose.
- **Use help as the discovery surface.** Start with `wikigraph --help` as the root page, then follow `wikigraph help overview`, `wikigraph help ai`, topic pages, or command-specific `--help` before guessing behavior.
- **Prefer `--json`.** Use it when composing with tools.
- **Inspect before starting jobs.** Do not start broad Reading Graph, Reading Summary, or Knowledge Graph work without `wikigraph <archive-uri> inspect`.
- **Check exit codes.** Success returns `0`; failure returns non-zero with a plain-text error on `stderr`.
- **Do not inspect `database.db` routinely.** Use URI-first reads, scope queries, and graph navigation commands instead.

Useful help entry points:

```bash
wikigraph help overview
wikigraph help ai
wikigraph help task
wikigraph help config
wikigraph help env
wikigraph help config-file
wikigraph help command
```

Full agent guidance: [AI Agent Guide](./docs/en/ai-agents.md).
