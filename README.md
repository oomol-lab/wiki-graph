![](./docs/images/terminal-en.png)

<div align="center">
  <h1>Wiki Graph</h1>
  <p>English | <a href="./README_zh-CN.md">中文</a></p>
  <p>
    <a href="https://www.npmjs.com/package/wiki-graph"><img alt="npm version" src="https://img.shields.io/npm/v/wiki-graph"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

Wiki Graph is an open-source CLI for managing long-text knowledge bases, built toward [Andrej Karpathy](https://github.com/karpathy)'s [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) idea and Google's [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) direction.

It writes plain text into `.wikg` archives and can generate searchable, source-traceable Knowledge Graphs on demand. In practice, it provides a runnable CLI for turning Karpathy's LLM Wiki idea into an executable knowledge production workflow.

In agent workflows, PDFs, web pages, EPUBs, subtitles, meeting recordings, video courses, and internal documents can first be converted into plain text by external tools, then handed to Wiki Graph. Wiki Graph handles the second half: placing that long text into a knowledge base, extracting Entities and Triples, and preserving evidence that can be traced back to chapters and original sentences. When compressed reading is needed, it can also build a Reading Graph and generate a Summary from it.

Karpathy's core point is that AI should not go back to raw material from scratch every time it answers a question; knowledge should be compiled into a maintainable Wiki. OKF pushes this kind of Wiki practice toward open, portable knowledge formats. Wiki Graph makes the OKF source layer concrete: it turns long text into knowledge material that a Wiki or OKF system can continue to consume, including entities, relations, and evidence that can point back to the source.

[![Watch the video](./docs/images/youtube-cover.png)](https://www.youtube.com/watch?v=UyXLZZTyCsM)

## Quick Start

Requirement: Node.js `>=22.12.0`

Install:

```bash
$ npm install -g wiki-graph
```

The primary command is `wg`; `wikigraph` is also available.

Create an empty `.wikg` knowledge base:

```bash
$ wg wikg://quickstart.wikg create
```

Add text as two source chapters:

```bash
$ printf "Alpha is connected to beta.\n" | wg wikg://quickstart.wikg/chapter add --title "First note" --input -

$ printf "Beta mentions gamma.\n" > tmp.txt && wg wikg://quickstart.wikg/chapter add --title "Second note" --input ./tmp.txt
```

Show the chapter tree:

```bash
$ wg wikg://quickstart.wikg/chapter/tree

├─ First note  wikg://chapter/1
└─ Second note  wikg://chapter/2
```

Enable and build the FTS index. Full-text `--query` search is available after this step:

```bash
$ wg wikg://quickstart.wikg/index enable
```

Search the content:

```bash
$ wg wikg://quickstart.wikg --query alpha

@@ wikg://chapter/1/source#1 @@
Alpha is connected to beta.
```

## Why We Built This

This project started as SpineDigest, with a focus on compressing long text into shorter summaries that were easier to read and carry. That version was built around a reading problem: how can an LLM read a whole book more like a person, keep useful threads in limited working memory, and still return to the source when needed? It used the ideas behind [Miller's Law](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two) and cognitive [chunking](<https://en.wikipedia.org/wiki/Chunking_(psychology)>) to organize long text into a Reading Graph, then generated summaries from that structure.

The metaphor at the time was a dissertation defense: professors keep questioning the respondent, reminding them which claim has evidence, which concepts are connected, and which ideas should not be collapsed together. The diagram below describes that older reading-and-summary flow, but it also explains where Wiki Graph starts: long text should not only be flattened once; it should become a structure that can be re-entered, questioned, and verified.

![Reading flowchart](./docs/images/flowchart.svg)

The center of gravity later changed. Summaries are still useful, but a summary is only one projection of long text. The more durable material is the entities, relations, and evidence inside the text. SpineDigest became Wiki Graph, and the main line moved from compressed reading to building maintainable Knowledge Graphs.

Karpathy's LLM Wiki gives an important direction: knowledge should not be retrieved from raw material from scratch every time; it should be compiled into a maintainable Wiki. In that setup, besides raw sources and the Wiki itself, there is also a schema layer: a maintenance rulebook for the Agent, defining how the Wiki should be organized, how pages should be shaped, how cross-references work, and how new source material should be ingested. Because that rulebook evolves between a person and an LLM around their own domain, preferences, and material, it naturally becomes a private schema. When the Wiki also depends heavily on private entities, the Agent often has to read, extract, and revise repeatedly to find as many entities, relations, and structures as possible. In other words, extraction quality depends not only on model capability, but also on whether that rulebook stays clear and stable; once it drifts, information is easier to miss and hallucinations are easier to write into the knowledge base.

Wiki Graph starts from a more determinate layer: public entities. Wikipedia / Wikidata acts like a shared public dictionary, already giving relatively stable semantic boundaries to many people, organizations, places, concepts, terms, statutes, and events. Wiki Graph uses [WikiSpine](https://github.com/moskize91/wikispine) to scan text, recall entities that may correspond to Wikipedia / Wikidata, and then use an LLM for disambiguation and filtering. This is closer to recalling candidate entities from a public dictionary and asking the model to disambiguate them, rather than asking the model to decide entity boundaries from scratch; public entity extraction also does not depend on a private schema jointly maintained by a person and an Agent.

Because this route depends on what Wikipedia / Wikidata already covers, it cannot cover every private entity: internal code names in an employee handbook, ordinary names in a phone book, or non-notable characters in a newly written novel. That is an intentional tradeoff. Wiki Graph does not rush to cover every entity; it first gains stability and reuse for public entity extraction. Once an entity is aligned to the same QID, relations and evidence can accumulate onto the same knowledge object across chapters, books, and source collections.

What Wiki Graph aims to do is sediment the public knowledge in long text that can be stably aligned into a source layer, so it can become a searchable, traceable, and extensible foundation for a knowledge base.

## Core Concepts

### `.wikg`

`.wikg` is the archive file Wiki Graph uses to create, maintain, and share a knowledge base. It can store source text, a chapter tree, Knowledge Graphs, Reading Graphs, summaries, index policy, and metadata, while organizing knowledge base content through hierarchical chapters.

In the LLM Wiki framing, a knowledge base often resembles a person's second brain: private, continuously growing, and mixed with many personal schemas. `.wikg` is a portable complement to that direction. It gives a knowledge base a clear scope, so it can be organized and delivered like a book, a website, a course, or a set of meeting records.

It can be used as a personal knowledge base and gradually organized over time. It can also preserve the structure of the original material, such as book chapters, website sections, course units, or video segments. The producer and consumer of a knowledge base need not be the same person; a `.wikg` file can be copied, sent, uploaded, backed up, and shared.

### Knowledge Graph

Knowledge Graph is Wiki Graph's main generated result. It extracts people, organizations, concepts, events, and relations scattered across long text, so the knowledge base is no longer only a searchable text collection. It becomes a structured knowledge network that can be followed through entities and relations.

Relations are projected as triples: `subject --predicate--> object`. This makes it possible to start from one entity and continue asking what it is connected to, what kind of relation it has, and which source evidence supports that relation.

This matters especially for long text. The same concept may appear across many chapters, and the same relation may be supported by multiple passages. Knowledge Graph collects those dispersed signals into the same knowledge object, making it easier to see "what is related to what", "where this claim came from", and "which chapters support the same knowledge point".

Typical questions include:

- Which important entities appear in the document?
- What objects is a given entity related to?
- Which source passages support a relation?
- Which chapters or passages support the same knowledge point?

Wiki Graph's Knowledge Graph is mainly composed of Entity, Triple, and Evidence. Entity is a normalized public entity, usually aligned by [WikiSpine](https://github.com/moskize91/wikispine) to a Wikipedia / Wikidata QID, such as a person, organization, place, concept, term, or statute. Private names, internal code names, and unpublished fictional settings are not its main coverage. Triple is an entity-level relation:

```text
subject --predicate--> object
```

Evidence is the source basis for an entity or relation. Wiki Graph's Knowledge Graph is not meant to only return conclusions; it should also be able to return to source text.

### Summary Generation

Wiki Graph can also generate chapter summaries, compressing long text into shorter reading results that are easier to carry and reuse.

The summary is not produced by flattening the whole text in one pass. Wiki Graph first builds a Reading Graph: following the idea of cognitive chunks in [Miller's Law](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two), it breaks long text into traceable [chunks](<https://en.wikipedia.org/wiki/Chunking_(psychology)>), connects them by conceptual relevance, and then organizes them back into reading chains in source order. The Summary is generated from the Reading Graph, so the compressed text can still trace back to source evidence.

### Wiki Graph URI

Wiki Graph uses URIs as stable handles for archives, scopes, and objects. A URI points to either a scope or an object: a scope enumerates or searches a collection of objects, while an object reads or operates on one concrete object.

```bash
$ wg wikg://book.wikg/chapter
$ wg wikg://book.wikg/chapter/3
$ wg wikg://book.wikg/chapter/3/chunk
$ wg wikg://book.wikg/entity
$ wg wikg://book.wikg/triple/Q8018/discusses
```

The examples above are scope URIs. Calling a scope URI directly lists objects. Adding `--query` searches within that scope. Adding `--limit` limits the number of returned results. Adding `--all` retrieves the full result set, which is suitable for intentional full export or inventory work.

```bash
$ wg wikg://book.wikg/chapter/3 --query "memory"
$ wg wikg://book.wikg/entity --query "neural network" --limit 5
$ wg wikg://book.wikg/chapter --all --json
```

Object URIs read one concrete object by default:

```bash
$ wg wikg://book.wikg/chapter/3/title
$ wg wikg://book.wikg/chapter/3/source#4..8
$ wg wikg://book.wikg/chapter/3/chunk/12
$ wg wikg://book.wikg/entity/Q8018
$ wg wikg://book.wikg/triple/Q8018/discusses/Q123
```

Most objects can be scoped to a chapter, such as `chapter/3/source#4..8`, `chapter/3/chunk/12`, or `chapter/3/entity/Q8018`. Some objects can also be accessed at archive scope, such as `entity/Q8018` and `triple/Q8018/discusses/Q123`; the same entity or relation may be supported by multiple chapters.

The front part of a URI is the archive locator. Absolute paths, relative paths, and Windows paths must be written as Wiki Graph URIs instead of bare filesystem paths:

```bash
$ wg wikg:///Users/me/books/book.wikg
$ wg wikg://book.wikg
$ wg wikg://C:/Users/me/books/book.wikg
```

Command output often contains short URIs:

```text
wikg://chapter/3/source#4..8
wikg://entity/Q8018
wikg://triple/Q8018/discusses/Q123
```

These short URIs are archive-relative handles. They keep output readable, but they are not complete command targets. Add the archive locator before passing them back to the CLI:

```bash
$ wg wikg://book.wikg/chapter/3/source#4..8
$ wg wikg:///Users/me/books/book.wikg/entity/Q8018
```

The common command shape is "URI + predicate". The URI appears first, but it is the object being operated on; the predicate says what to do with it. Without a predicate, a scope URI usually performs list, and an object URI usually performs read.

```bash
$ wg wikg://book.wikg/entity/Q8018
$ wg wikg://book.wikg/entity/Q8018 evidence
$ wg wikg://book.wikg/entity/Q8018 related --query "memory"
$ wg wikg://book.wikg/entity/Q8018 pack --budget 5000 --json
```

For more URI rules and boundaries, use the CLI help. You can start from the URI topic, or ask for help on a specific URI or URI predicate:

```bash
$ wg help uri
$ wg wikg://book.wikg/entity/Q8018 --help
$ wg wikg://book.wikg/entity/Q8018 evidence --help
```

## Common Workflows

### Create a Knowledge Base

```bash
$ wg wikg://book.wikg create
$ wg wikg://book.wikg create --import ./book.epub
```

Without `--import`, this creates an empty `.wikg` knowledge base. `--import` accepts EPUB only; it creates the knowledge base and imports EPUB metadata, cover, chapter tree, and source text.

### Inspect Archive State

```bash
$ wg wikg://book.wikg inspect
$ wg wikg://book.wikg inspect --json
```

`inspect` reports what the archive currently contains, which capabilities are not ready yet, and which help page or command should be used next.

### Generate Knowledge Graph

```bash
$ wg wikg://local/job add --input wikg://book.wikg --task knowledge-graph --accept-cost
$ wg wikg://local/job add --input wikg://book.wikg/chapter/3 --task knowledge-graph --accept-cost
$ wg wikg://local/job/<job-id> watch --jsonl
```

Generation jobs may call an LLM provider. Time and cost depend on material length, model, and configuration. Read `inspect` and job help before starting a job.

### Search Entities and Relations

```bash
$ wg wikg://book.wikg/entity --query "neural network" --evidence 2
$ wg wikg://book.wikg/triple --query "attention memory" --evidence 2
$ wg wikg://book.wikg/chapter/3/entity --query "attention"
$ wg wikg://book.wikg/chapter/3/triple --query "memory"
```

Use the narrowest useful URI scope. If the chapter is known, search from the chapter scope. Use the archive scope when a whole-archive view is needed.

### Trace Source Evidence

```bash
$ wg wikg://book.wikg/entity/Q8018 evidence
$ wg wikg://book.wikg/triple/Q8018/discusses/Q123 evidence
$ wg wikg://book.wikg/entity/Q8018 evidence --query "memory"
```

Use `evidence` when a statement, entity, relation, or answer needs to be checked against source material.

### Expand Related Objects

```bash
$ wg wikg://book.wikg/entity/Q8018 related --evidence 2
$ wg wikg://book.wikg/entity/Q8018 related --query "memory" --evidence 2
```

`related` expands from a selected object to nearby objects. For Entity, related results are mainly related triples.

### Prepare Context

```bash
$ wg wikg://book.wikg/entity/Q8018 pack --budget 5000
```

`pack` turns the surrounding context of a selected chunk or entity into portable text. Use `evidence` first when strict verification is needed.

## For AI Agents

Wiki Graph treats CLI help as part of the product contract. After installation, start from the root help; commands, URIs, predicates, configuration, runtime behavior, and format constraints can be discovered by following the help network, without guessing command shapes from the README.

```bash
$ wg --help
```

## License

Apache-2.0
