# wiki-graph-wikimedia

Runtime-neutral Wikimedia domain engine shared by `wiki-graph-core` and the
hosted `wg-wikimedia` service. It owns Wikimedia request/response parsing,
resolution, disambiguation prompts and result validation. Runtime-specific
SQLite, PostgreSQL, local scheduling and cluster coordination are injected.

`HttpWikimediaResolver` accepts either a service origin, where it calls
`/v1/qids:resolve`, or a path-prefixed gateway endpoint, where it appends
`qids:resolve` without discarding the gateway scope. It requires an API key and
sends it as a Bearer credential.
