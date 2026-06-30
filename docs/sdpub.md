# The `.sdpub` Format

This document describes the archive layout used by SpineDigest for
`.sdpub` knowledge-base archives.

It is written for implementations that need to inspect, parse, validate,
render, or interoperate with `.sdpub` files outside the SpineDigest runtime.

This is not the recommended guide for routine archive editing. `.sdpub`
is physically a ZIP file, but automation that wants to add chapters,
change metadata, set source text, reset stages, or advance generation
should use URI-first CLI commands such as `wikigraph wkg://book.sdpub/ set`,
`wikigraph wkg://book.sdpub/chapter add`, and
`wikigraph wkg://book.sdpub/chapter/3 queue add`.
Direct ZIP mutation is for external readers, validators, recovery tooling, or
format experiments that intentionally take responsibility for preserving every
invariant.

## Overview

An `.sdpub` file is a ZIP archive that stores a serialized SpineDigest
document directory.

It is not a source-preserving format. The original EPUB, PDF, Markdown,
or plain-text input is not embedded verbatim. Instead, the archive stores
the normalized source-derived state, graph-backed knowledge state, readable
projection state, and metadata that SpineDigest can reopen later.

At a high level, the archive contains three layers of data:

- document metadata and navigation
- source fragments and readable summary/projection text
- internal relational state for chunks, topology, and graph navigation

Archive-level compatibility is expressed by `manifest.json`.

In this document, a _serial_ means one persisted document unit referenced
from `toc.json` by `serialId`. A serial usually corresponds to one
chapter-like readable section. Depending on the archive stage, it may carry
source fragments, graph data, and a serial summary text file.

## Container Model

SpineDigest writes `.sdpub` as a ZIP file containing regular files only.

Conforming archives produced by SpineDigest use POSIX-style archive
paths and contain entries from this path set:

- `database.db`
- `manifest.json`
- `book-meta.json`
- `toc.json`
- `cover/info.json`
- `cover/data.bin`
- `summaries/serial-<serialId>.txt`
- `fragments/serial-<serialId>/fragment_<fragmentId>.json`

Current writer behavior:

- path separators are `/`
- files are added in lexicographic path order
- only the paths listed above are emitted

Reader guidance:

- do not depend on ZIP entry order
- normalize `\` to `/` before path matching
- reject path traversal after normalization
- treat unexpected entries as outside the format contract

SpineDigest's own extractor normalizes archive paths and rejects
directory escapes, but it does not enforce the whitelist at extraction
time. The whitelist is therefore a writer-side contract, not a strict
reader-side gate in the current implementation.

## Presence Rules

The format is easiest to understand if writer behavior and reader
requirements are treated separately.

For archives written by SpineDigest today:

| Path family                                              | SpineDigest writer behavior                      | Notes                                         |
| -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `database.db`                                            | always written                                   | Created for every document directory          |
| `manifest.json`                                          | always written                                   | Declares the archive-level format version     |
| `book-meta.json`                                         | always written                                   | Written for TXT, Markdown, and EPUB imports   |
| `toc.json`                                               | always written                                   | Written for TXT, Markdown, and EPUB imports   |
| `cover/info.json` + `cover/data.bin`                     | written together only when a source cover exists | Treat as a pair                               |
| `summaries/serial-<serialId>.txt`                        | written for summarized serials                   | Staged archives may omit summary files        |
| `fragments/serial-<serialId>/fragment_<fragmentId>.json` | written only for non-empty fragments             | Do not assume every serial has fragment files |

Source-specific notes:

- TXT input currently produces one top-level serial and never produces a
  cover. The TOC item may omit `title` when no title is supplied.
- Markdown input currently produces one top-level serial and never
  produces a cover. The TOC item may omit `title` when no title is
  supplied.
- EPUB input may or may not produce a cover.
- EPUB input may produce grouping TOC nodes that omit `serialId`.
- When the CLI is run with `--stage planned`, serials are allocated but
  source fragments, graph data, and summaries are omitted.
- When the CLI is run with `--stage source`, source fragments are
  written but graph data and summaries are omitted.
- When the CLI is run with `--stage reading-graph`, graph data is written but
  summaries are omitted.

For readers and validators:

- `toc.json` plus `summaries/` is the minimum useful set for ordered summary
  projection rendering of completed archives. Staged archives may require
  queued Reading Summary generation before summary projection is complete.
- `book-meta.json` is optional for plain rendering, but required if
  metadata is part of the target feature set.
- `cover/info.json` and `cover/data.bin` are optional as a pair.
- `fragments/` is optional unless source-backed reading, evidence tracing,
  fragment-level, or sentence-level data is needed.
- `database.db` is optional for lightweight rendering, but should be
  treated as required for full-fidelity knowledge graph and SpineDigest
  interoperability.

## Archive Layout

- `database.db`: SQLite database with internal indexed state for
  serials, chunks, topology, and graph relationships
- `manifest.json`: UTF-8 JSON with the archive-level format version
- `book-meta.json`: UTF-8 JSON with source-level metadata for the
  processed document
- `toc.json`: UTF-8 JSON with the navigation tree used for export and
  reading order
- `cover/info.json`: UTF-8 JSON with cover metadata
- `cover/data.bin`: binary cover payload
- `summaries/serial-<serialId>.txt`: UTF-8 text with the readable summary
  projection for one serial
- `fragments/serial-<serialId>/fragment_<fragmentId>.json`: UTF-8 JSON
  with fragment-level summaries and sentence payloads for one serial

Serial ids are integers. SpineDigest currently allocates them from the
SQLite `serials` table, which means produced archives typically start at
`1`.

Fragment ids are integers scoped to a serial. SpineDigest currently
allocates them from `0` upward within each serial directory.

## File Formats

### `manifest.json`

`manifest.json` declares the archive-level `.sdpub` format version.

Current schema:

```json
{
  "formatVersion": 1
}
```

Field contract:

- `formatVersion`: currently `1`

Archives that omit `manifest.json` are invalid.

### `book-meta.json`

`book-meta.json` stores metadata about the original source document.

Current schema:

```json
{
  "version": 1,
  "sourceFormat": "epub",
  "title": "Example Book",
  "authors": ["Author One", "Author Two"],
  "language": "en",
  "identifier": "urn:example:book",
  "publisher": "Example Press",
  "publishedAt": "2025-01-01",
  "description": "Optional source description."
}
```

Field contract:

- `version`: currently `1`
- `sourceFormat`: one of `epub`, `pdf`, `txt`, or `markdown`
- `title`: non-empty string or `null`
- `authors`: array of non-empty strings
- `language`: non-empty string or `null`
- `identifier`: non-empty string or `null`
- `publisher`: non-empty string or `null`
- `publishedAt`: non-empty string or `null`
- `description`: non-empty string or `null`

`sourceFormat` describes the source type recorded in the document
metadata. It is not a promise that the current public CLI necessarily
accepts that source type as direct input.

The public CLI can inspect and edit these fields with the archive root object,
for example `wikigraph wkg://book.sdpub/ get --json` and
`wikigraph wkg://book.sdpub/ set --title "New Title"`. The command preserves
`version` and `sourceFormat`.

### `toc.json`

`toc.json` defines the chapter-like navigation tree and exported reading
order.

Current schema:

```json
{
  "version": 1,
  "items": [
    {
      "title": "Part I",
      "children": [
        {
          "title": "Chapter 1",
          "serialId": 1,
          "children": []
        }
      ]
    }
  ]
}
```

Each item contains:

- `title`: optional non-empty string or `null`
- `serialId`: optional non-negative integer
- `children`: array of child items

Ordering is significant. Readers should preserve item order exactly as written.

A node may omit `serialId` and act as a pure grouping node. When
`serialId` is present, it points to
`summaries/serial-<serialId>.txt` when summary projection data exists and may
also have a matching fragment directory.

A node may omit `title` or set it to `null`. Text renderers may omit the
heading for such nodes. EPUB renderers should use a display fallback such
as `Section <serialId>` because EPUB navigation and section documents
need visible labels.

### `cover/info.json` and `cover/data.bin`

The cover is split into metadata and raw bytes.

`cover/info.json` has this shape:

```json
{
  "mediaType": "image/png",
  "path": "images/cover.png"
}
```

Field contract:

- `mediaType`: MIME type of the cover asset
- `path`: original or source-derived asset path string

`cover/data.bin` contains the raw bytes for that asset.

The `path` field is metadata. It is not an archive path and should not
be resolved inside the `.sdpub` container. SpineDigest currently uses
it mainly to preserve a useful filename extension when exporting EPUB
again.

### `summaries/serial-<serialId>.txt`

Each completed serial summary is stored as a standalone UTF-8 text file.

The text is the serial-level readable summary/projection content used by
plain-text and EPUB export. The file may be empty. Readers should not depend on
a trailing newline.

### `fragments/serial-<serialId>/fragment_<fragmentId>.json`

Each fragment file stores lower-level sentence payloads plus a fragment
summary field.

```json
{
  "summary": "Fragment summary.",
  "sentences": [
    {
      "text": "First sentence.",
      "wordsCount": 2
    },
    {
      "text": "Second sentence.",
      "wordsCount": 2
    }
  ]
}
```

Field contract:

- `summary`: string, possibly empty
- `sentences`: array of sentence records

Each sentence record contains:

- `text`: sentence text
- `wordsCount`: numeric word count recorded by SpineDigest

Fragment files must use the object form above. `summary` and `sentences`
are required.

### `database.db`

`database.db` is a SQLite database containing SpineDigest's indexed internal state.

The current schema includes these tables:

- `serials`
- `serial_states`
- `chunks`
- `chunk_sentences`
- `reading_edges`
- `snakes`
- `snake_chunks`
- `snake_edges`
- `fragment_groups`

SQLite may also add engine-managed tables such as `sqlite_sequence`.
Those are not part of the SpineDigest application schema.

This database is useful when an implementation needs full structural fidelity
with SpineDigest's internal model, including graph-backed LLM Wiki behavior.

A minimal reader does not need to understand the entire database. For
simple summary projection rendering of completed archives, `toc.json` plus
`summaries/` is enough. For source-fragment or sentence-level inspection,
`fragments/` is enough for sentence payloads, but `toc.json` is still needed if
reading order or section titles matter. The SQLite layer matters when the
implementation needs chunk topology, graph data, local navigation, or close
parity with SpineDigest internals.

## Reading Strategy

An implementation can choose its reading depth based on its use case.

For a lightweight projection reader:

1. read `book-meta.json` if metadata is needed
2. read `toc.json`
3. follow each summarized `serialId` into `summaries/serial-<serialId>.txt`
4. read `cover/info.json` and `cover/data.bin` only if a cover is needed

For a source-aware reader:

1. read the same files as above
2. read `fragments/serial-<serialId>/fragment_<fragmentId>.json` in
   fragment id order within each serial

For a full-fidelity knowledge-base implementation:

1. parse the file tree
2. open `database.db`
3. reconcile SQLite state with summaries and fragments as needed by the
   application

## Compatibility Notes

- `manifest.json` carries the archive-level format version.
- Archives without `manifest.json` are invalid.
- `book-meta.json` currently uses `version: 1`.
- `toc.json` currently uses `version: 1`.
- Fragment files have no explicit version field.
- SpineDigest-produced archives contain only known paths. Unknown
  paths are outside the compatibility contract and may be dropped if
  the archive is reopened and saved again by SpineDigest.

## Validation Notes

Readers that accept untrusted `.sdpub` input should validate at least the following:

- the ZIP entry path normalizes to a safe relative path
- JSON payloads match the expected schema
- every summarized `serialId` referenced by `toc.json` has a matching summary
  file when the target feature set requires summary projection data
- cover metadata and cover bytes either both exist or are both absent
- fragment files, if present, use non-negative integer ids and valid
  sentence records

Whether `database.db` should be treated as required depends on the target
feature set. SpineDigest archives normally include it, but not every downstream
reader needs to interpret it. Implementations that want LLM Wiki-style graph
navigation should treat it as part of their required data surface.

## Related Sources

- [`src/facade/archive.ts`](../src/facade/archive.ts)
- [`src/document/document.ts`](../src/document/document.ts)
- [`src/document/fragments.ts`](../src/document/fragments.ts)
- [`src/document/schema.ts`](../src/document/schema.ts)
- [`src/source/meta.ts`](../src/source/meta.ts)
- [`src/source/toc.ts`](../src/source/toc.ts)
