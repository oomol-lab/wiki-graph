# wiki-graph-job

Runtime-neutral chapter build engine shared by `wiki-graph-core` and the
hosted `wg-job` service.

The package owns the six chapter JSONL input and artifact contracts, their
validation, and the build algorithms. A host gives it an input file, a
revision, and an empty request-scoped directory; the result is an artifact
JSONL file plus the same revision. Hosts inject LLM, embedding, WikiSpine and
Wikimedia capabilities. Queue state, `.wikg` access, HTTP transport, artifact
application, and provider selection remain host responsibilities.

Reading-summary completion is independent of text length. Every successful
reading-summary artifact contains at least one `summary-part` record.
An empty result is represented explicitly by
`{"type":"summary-part","position":0,"text":""}`; a zero-byte artifact is
invalid. Positions start at zero and are contiguous and unique.

Applying an explicit empty summary creates a present, empty summary text
stream. Chapter stage, SDK inspection, and CLI state therefore report it as
completed even though it has no sentences. Missing and empty summaries are
distinct; resetting the reading graph or changing source removes completion.

An empty summary-embedding snapshot is valid for a completed empty summary.
Like an empty source-embedding snapshot, it produces an `embedding-metadata`
record with no segments and does not call the embedding provider. Applying it
creates a current empty index, distinct from a missing index.
