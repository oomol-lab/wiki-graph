# wiki-graph-job

Runtime-neutral chapter build engine shared by `wiki-graph-core` and the
hosted `wg-job` service.

The package owns the six chapter snapshot and artifact contracts, their
validation and codecs, and the build algorithms. Hosts inject LLM, embedding,
WikiSpine and Wikimedia capabilities and provide an empty request-scoped
workspace. Queue state, `.wikg` access, HTTP transport and provider selection
remain host responsibilities.
