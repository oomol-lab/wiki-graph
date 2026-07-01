<p>English | <a href="../zh-CN/architecture.md">中文</a></p>

# Architecture

This document explains SpineDigest at the system level. It is intentionally secondary to the CLI docs; start with [Quick Start](./quickstart.md) if your goal is to run the tool.

## System Model

SpineDigest is built around one primary object: the `.wikg` knowledge-base archive. EPUB, Markdown, plain text, direct transform output, and exported EPUB/Markdown files are all inputs or projections around that archive.

At a high level, SpineDigest has four layers:

1. Source layer: read EPUB, Markdown, plain text, or stdin and normalize it into source-backed chapter data.
2. Knowledge layer: build Reading Graph chunks and summaries, and build Knowledge Graph entity mentions, mention links, and entity-level relations from source fragments.
3. Retrieval layer: expose existing archive data through CLI primitives such as `chapter list`, `chapter state`, `chapter tree`, `search`, `list`, `get`, `related`, `evidence`, and `pack`.
4. Projection layer: export portable views such as Markdown, txt, EPUB, JSON-style command output, or one-shot `transform` results.

The archive is the durable object. Projections are useful views, but they do not replace the `.wikg` when graph links, source fragments, and repeatable retrieval matter.

## Main Modules

- `facade`: top-level user-facing entry points for archive creation, archive viewing, graph operations, and export
- `cli`: command-line assembly, argument parsing, help routing, and config loading
- `source`: readers for EPUB, Markdown, and plain text
- `document`: on-disk document state, archive I/O, metadata, fragments, and schema ownership
- `llm`: provider configuration, model requests, request cache, request logs, sampling options, and provider error normalization
- `guaranteed`: shared structured-output retry flow used when an LLM response must satisfy a schema
- `evidence-selection`: shared sentence evidence positioning for Reading Graph and Knowledge Graph builders
- `reader`: LLM-guided extraction over the text stream
- `topology`: graph construction from reader output
- `editor`: summary/projection generation from topology groups
- `wikimatch`: Knowledge Graph surface screening, Wikidata/Wikipedia candidate enrichment, and LLM grounding decisions
- `wikilink`: Knowledge Graph mention-link windowing and relation discovery support
- `wikipage`: Wikipedia page/QID resolution, caching, normalization, and request throttling
- `progress`: progress tracking and event callbacks for LLM-backed build work
- `serial.ts`: glue between source serials, reader output, topology, and summaries

## Build Stages

User-facing stages describe how much knowledge has been built into the archive:

- `source`: normalized source data and metadata are present
- `reading-graph`: reading-oriented chunks, links, and source-backed knowledge units are present
- `reading-summary`: readable chapter summaries and export projections are available
- `knowledge-graph`: grounded entity mentions and source-backed relations are available for URI-based search and evidence tracing

`source` is cheap and does not require LLM access. Reading Graph, Reading Summary, and Knowledge Graph queue tasks may call an LLM provider and should be estimated before full-archive builds.

Knowledge Graph construction is source-first. It screens source text for mention candidates, grounds those mentions to QIDs, then asks the model to discover relations between grounded mention IDs. Relation evidence is resolved through the shared evidence-selection protocol, which uses sentence IDs plus short source quotes so both Reading Graph and Knowledge Graph builders can correct sentence drift without owning each other's business objects.

## Why `.wikg` Exists

`.wikg` exists so long documents can become reusable knowledge bases rather than one-time outputs.

It preserves:

- source-derived chapter structure
- source fragments that support later reading and evidence tracing
- graph nodes and links for navigation
- summaries and other readable projection data
- metadata and cover information

This allows the same archive to support multiple later tasks: structural browsing, exact source checks, continuous reading, context packing, export, and external rendering.

## Public Versus Internal Boundaries

The public surface is intentionally small:

- the CLI
- `SpineDigestApp`
- `SpineDigest`

The CLI is the most complete knowledge-base interface. The library API is lower-level and still reflects the digest session internals more directly.

Most other modules are internal implementation details and may evolve more freely.

## Design Biases

SpineDigest is optimized for:

- CLI-first knowledge-base usage
- long-form reading material
- portable `.wikg` archives
- deterministic retrieval primitives for humans and agents
- small public entry points with richer internal structure

It is not optimized for:

- exact round-tripping of original source packages
- natural-language QA as a built-in answer layer
- exposing every internal module as public API
