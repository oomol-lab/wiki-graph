# wiki-graph-wikimedia

Runtime-neutral Wikimedia domain engine shared by `wiki-graph-core` and the
hosted `wg-wikimedia` service. It owns Wikimedia request/response parsing,
resolution, disambiguation prompts and result validation. Runtime-specific
SQLite, PostgreSQL, local scheduling and cluster coordination are injected.

`HttpWikimediaResolver` accepts either a service origin, where it calls
`/v1/qids:resolve`, or a path-prefixed gateway endpoint, where it appends
`qids:resolve` without discarding the gateway scope. It requires an API key and
sends it as a Bearer credential. Inputs are streamed through sequential HTTP
requests of at most 1,000 entities while result indexes continue to refer to
the original complete input.

Resolvers expose an `AsyncIterable` of `{ index, resolution }` records. The
index correlates each streamed result with the original input and permits
cached or otherwise faster records to arrive out of order without losing
duplicate inputs. Consumers must finish iteration to observe terminal errors.

The remote protocol is NDJSON. It accepts `resolution`, `heartbeat`, `error`,
and terminal `done` events; closing without `done` is an error. Stopping
iteration cancels the response body, and an optional `AbortSignal` is forwarded
through remote and direct providers.

Direct Wikimedia access treats `maxlag`, rate limiting, HTTP 403/408/425/5xx,
and transport failures as temporary feedback. It retries with bounded
exponential backoff and jitter rather than an attempt count. One resolver
operation shares a 30-minute cumulative retry-wait budget across all upstream
requests; ordinary processing time does not consume that budget. Terminal
stream errors preserve a stable code, retryability, and retry delay when the
provider supplies them.
