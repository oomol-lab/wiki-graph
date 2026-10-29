English | [中文](README_zh-CN.md)

# Wiki Graph Runtime

Portable provider execution for SDK and service hosts. This package does not read environment variables or own credentials, storage, or job algorithms.

`ProviderRuntime` executes an entire provider operation under a shared deadline and bounded transport retry/wait budgets. Create one instance per credential/provider scope. `createOpenAICompletion` buffers one OpenAI-compatible SSE candidate, discards interrupted candidates, and reports available usage for each attempt. Configure headers, fetch, cancellation, policy and observers at the host boundary.

`requestGuaranteedJson` owns JSON repair, asynchronous schema/business validation and refusal detection. Only `ParsedJsonError` requests business repair; provider, cancellation and programming failures propagate. Its fourth request callback argument carries the shared deadline and signal; adapters must forward both. Accepted empty JSON results remain valid.

`createJsonRequest` applies the same transport policy to JSON POST endpoints such as embeddings, including response-body read failures. It buffers up to `maxResponseBytes` (16 MiB by default); malformed or oversized successful responses fail without replay. It does not repair or validate business content. Rate-limit cooldowns also apply to queued callers, even when the request that received the rate limit has exhausted its retries.

The default transport policy allows two retries, exponential jittered delay, a 60-second waiting budget and a 360-second operation deadline. A content repair loop shares one deadline rather than renewing it per candidate. Core retains its retry count and interval settings, with timeout now bounding the complete request including retries.

Retries of POST requests may duplicate provider work and billing. Usage callbacks report cumulative snapshots per attempt; hosts must deduplicate snapshots and retain consumed usage even if a candidate is rejected. Missing usage is unknown.

`safeErrorGraph` projects bounded nested diagnostics without messages, request bodies or headers. `mapConcurrent` pulls bounded windows, preserves the first failure and drains cooperative sibling work before closing its input. Hosts must isolate uncooperative operations; a timeout alone cannot release their resources.

See [runtime maintenance](../../docs/provider-runtime.md) for adapter and regression contracts.

`CapacityPool` and resource leases bound both active work and queued callers; cancelled work keeps its slot until its resources settle. `CandidateAcceptance` defers publication until validation, `QualityGate` makes partial fallback configurable, and `UsageLedger` retains known consumption independently of candidate acceptance. `ProgressTracker` deduplicates monotonic phase/unit/attempt progress. Awaited statistics persistence failures propagate; diagnostic sink failures are isolated.
