# wiki-graph-job

Runtime-neutral chapter build engine shared by `wiki-graph-core` and the
hosted `wg-job` service.

The package owns the six chapter JSONL input and artifact contracts, their
validation, and the build algorithms. A host gives it an input file, a
revision, and an empty request-scoped directory; the result is an artifact
JSONL file plus the same revision. Hosts inject LLM, embedding, WikiSpine and
Wikimedia capabilities. Queue state, `.wikg` access, HTTP transport, artifact
application, and provider selection remain host responsibilities.
