# `.wikg` Archive Standard

This document defines the public `.wikg` archive layout. It explains what a
`.wikg` file is, which files may appear inside it, what those files mean, and
which compatibility rules readers and writers should follow.

This is a format standard, not a CLI tutorial. Use the CLI help for command
syntax.

## Container

A `.wikg` file is a ZIP archive with a `.wikg` filename extension.

Archive entry paths must use `/` separators and must be relative paths. Readers
normalize incoming ZIP entry names by trimming whitespace, converting `\` to
`/`, removing leading `/`, and collapsing `.` path components. Entries outside
the `.wikg` whitelist are ignored by standard readers and are not preserved by
standard writers.

The current standard writer stores ZIP entries without compression. Standard
readers accept stored ZIP entries and deflated ZIP entries.

## Entry Table

Only the following archive entries are part of the standard layout:

| Entry                          | Required | Type            | Meaning                                                           |
| ------------------------------ | -------- | --------------- | ----------------------------------------------------------------- |
| `.wikg-mutation-token`         | Yes      | UTF-8 text      | Archive mutation token. Must be the first ZIP entry.              |
| `manifest.json`                | Yes      | JSON            | Archive format manifest.                                          |
| `database.db`                  | Yes      | SQLite database | Main document, graph, metadata, and readiness database.           |
| `toc.json`                     | No       | JSON            | Chapter tree.                                                     |
| `cover/info.json`              | No       | JSON            | Cover metadata.                                                   |
| `cover/data.bin`               | No       | Binary          | Cover binary payload. Required when `cover/info.json` is present. |
| `texts/source/<serialId>.txt`  | No       | UTF-8 text      | Source text stream for one chapter serial.                        |
| `texts/summary/<serialId>.txt` | No       | UTF-8 text      | Summary text stream for one chapter serial.                       |
| `fts.db`                       | No       | SQLite database | Embedded full-text search index.                                  |

No other entry is currently standard. Examples of non-standard entries include
SQLite journal files, arbitrary JSON sidecars, and text files outside
`texts/source/` or `texts/summary/`.

## Required Entries

### `.wikg-mutation-token`

`.wikg-mutation-token` must be the first ZIP entry. Its content is UTF-8 text:

```text
wikg-mutation-token:v1
<token>
```

Standard writers end the file with a newline. Readers must validate the magic
line and token line, and may accept payloads with or without the final trailing
newline. `<token>` is a 43-character base64url string matching:

```text
[A-Za-z0-9_-]{43}
```

Writers must refresh this token whenever they rewrite the archive. Readers use
it to detect archive mutation and coordinate cached materializations.

### `manifest.json`

`manifest.json` identifies the archive format version. For the current format,
its complete JSON shape is:

```json
{
  "formatVersion": 1
}
```

Readers must reject archives without `manifest.json`, archives with invalid
JSON in `manifest.json`, and archives whose `formatVersion` is not supported.

### `database.db`

`database.db` is the main SQLite database. It owns the structured state of the
archive, including:

- chapter serial records and revision state;
- Reading Graph chunks, edges, snakes, and sentence groups;
- Knowledge Graph mentions, mention links, entity projections, triple
  projections, and evidence references;
- object metadata, including archive-level book metadata;
- generation parameter hashes and readiness state;
- index embedding policy.

Book metadata is not stored as a top-level `meta.json` file. It is stored in
`database.db` as archive-level object metadata.

The schema is part of the implementation contract for the current reader and
writer. External tools should prefer public CLI/API access instead of mutating
this database directly.

## Optional Entries

### `toc.json`

`toc.json` stores the chapter tree. The current JSON shape is:

```json
{
  "version": 1,
  "items": [
    {
      "title": "Chapter title",
      "serialId": 1,
      "children": []
    }
  ]
}
```

Rules:

- `version` must be `1`.
- `items` is an array of chapter tree nodes.
- `title` is optional and may be `null`.
- `serialId` is optional and, when present, is a non-negative integer.
- `children` is required on every node and is an array of child nodes.
- `serialId` links a TOC node to source, summary, database rows, and generated
  graph state for the same chapter serial.

### `cover/info.json` and `cover/data.bin`

The cover is represented by a metadata file plus a binary payload. The archive
does not preserve the cover at its original internal path. Instead, the original
or logical path is recorded in `cover/info.json`, and the bytes are stored in
`cover/data.bin`.

`cover/info.json` has this shape:

```json
{
  "mediaType": "image/png",
  "path": "cover.png"
}
```

Rules:

- `mediaType` is a non-empty MIME type string.
- `path` is the original or logical cover path string.
- `cover/data.bin` contains the corresponding binary payload.
- If `cover/info.json` is present, `cover/data.bin` must also be present.

To extract the cover, read and validate `cover/info.json`, then copy
`cover/data.bin` to the desired output path. Use `mediaType` to choose or verify
the file type, and use `path` only as source metadata or as a suggested logical
name. Do not look for the cover image at `cover/info.json.path` inside the
`.wikg` archive.

An archive has no cover when `cover/info.json` is absent. In that case,
`cover/data.bin` should also be absent. If `cover/info.json` is present but
`cover/data.bin` is missing, the cover entry is corrupt rather than absent.

### `texts/source/<serialId>.txt`

Source streams are stored as UTF-8 text files under `texts/source/`.

Path rules:

- `<serialId>` is a decimal chapter serial id.
- The filename must be exactly `<serialId>.txt`.
- Non-numeric filenames under `texts/source/` are not standard entries.

The source stream is the factual grounding layer. Generated graph objects and
summaries should be traceable back to source sentence ranges derived from these
files.

### `texts/summary/<serialId>.txt`

Summary streams are stored as UTF-8 text files under `texts/summary/`.

Path rules are the same as source streams: the filename must be
`<serialId>.txt`, where `<serialId>` is a decimal chapter serial id.

Summaries are generated projections. They do not replace source text as the
grounding layer.

### `fts.db`

`fts.db` is an optional SQLite full-text search index.

Writers include `fts.db` only when the archive index policy marks the search
index as embedded. Otherwise, the search index may exist as a local cache and
must not be treated as required archive content.

Readers must be able to open archives without `fts.db`. Missing or stale search
index state should be handled as readiness information, not as archive
corruption.

## Path Whitelist

Standard readers and writers recognize only these path patterns:

```text
.wikg-mutation-token
manifest.json
database.db
fts.db
toc.json
cover/data.bin
cover/info.json
texts/source/<digits>.txt
texts/summary/<digits>.txt
```

Writers must not include transient SQLite files such as:

```text
database.db-journal
database.db-wal
database.db-shm
fts.db-journal
fts.db-wal
fts.db-shm
```

Writers must not include arbitrary sidecar files unless a future format version
adds them to the standard.

## Ordering

`.wikg-mutation-token` must be the first ZIP entry.

After that entry, standard writers sort archive paths lexicographically. Readers
must not depend on lexicographic order for entries other than the mutation token.

## Read Compatibility

A conforming reader should:

- require `.wikg-mutation-token` as the first entry;
- require a supported `manifest.json`;
- ignore non-standard entry paths;
- reject unsupported ZIP compression methods;
- accept archives without optional entries;
- treat `fts.db` as optional;
- validate JSON entries before using them;
- prevent path traversal when extracting archive entries.

## Write Compatibility

A conforming writer should:

- write `.wikg-mutation-token` first;
- write `manifest.json` with the current supported format version;
- include only standard entry paths;
- refresh `.wikg-mutation-token` on every archive rewrite;
- omit transient database files;
- include `fts.db` only when the archive declares an embedded search index;
- preserve source and summary text as UTF-8;
- keep `database.db` consistent with `toc.json` and text stream serial ids.

## Semantic Layers

The file layout is small, but the archive carries several semantic layers:

- Source layer: `texts/source/*.txt`, chapter serials, and source sentence
  records.
- Reading Graph: chunks, reading edges, snakes, and sentence groups in
  `database.db`.
- Knowledge Graph: mentions, mention links, entity projections, triple
  projections, and evidence references in `database.db`.
- Summary layer: `texts/summary/*.txt` plus summary sentence records.
- Search layer: optional `fts.db` and index settings in `database.db`.
- Metadata layer: archive, chapter, chunk, entity, and triple metadata in
  `database.db`, plus optional cover files.

Reading Graph objects and Knowledge Graph objects are separate layers. Chunks
are reading units; entities and triples are knowledge objects. Source text is the
grounding layer for both.

## Versioning

The current `.wikg` format version is `1`.

Future incompatible layout changes must increment `manifest.json`'s
`formatVersion`. A reader that does not understand a format version must reject
the archive instead of guessing how to interpret it.

Compatible additions may be introduced only when older readers can safely ignore
them. Because current standard readers ignore non-whitelisted entries, new
standard entries require either a reader update or a format-version change,
depending on whether older readers may safely drop them during rewrite.

## Related Documents

- [WikiSpine Runtime Guide](./wikispine-runtime.md)
- [README](../README.md)
