# wiki-graph-wikimedia

Runtime-neutral Wikimedia domain engine shared by `wiki-graph-core` and the
hosted `wg-wikimedia` service. It owns Wikimedia request/response parsing,
resolution, disambiguation prompts and result validation. Runtime-specific
SQLite, PostgreSQL, local scheduling and cluster coordination are injected.

`HttpWikimediaResolver` accepts either a service origin, where it calls
`/v1/qids:resolve`, or a path-prefixed gateway endpoint, where it appends
`qids:resolve` without discarding the gateway scope. It requires an API key and
sends it as a Bearer credential.

Resolvers expose an `AsyncIterable` of `{ index, resolution }` records. The
index correlates each streamed result with the original input and permits
cached or otherwise faster records to arrive out of order without losing
duplicate inputs. Consumers must finish iteration to observe terminal errors.

The remote protocol is NDJSON. It accepts `resolution`, `heartbeat`, `error`,
and terminal `done` events; closing without `done` is an error. Stopping
iteration cancels the response body, and an optional `AbortSignal` is forwarded
through remote and direct providers.
