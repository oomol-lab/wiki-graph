# Provider runtime maintenance

`packages/runtime` owns portable transport recovery and guaranteed JSON. Core and job re-export the existing guaranteed error classes so `instanceof` works across adapters. Do not add another transport retry loop in algorithms. The operation passed to `ProviderRuntime.run` must include consumption and cleanup, not just obtaining response headers.

## Boundaries

- The OpenAI adapter buffers candidates. Incremental NDJSON consumers must keep their own protocol termination semantics and must not replay already-delivered items.
- Terminal status/code classification takes priority over transient causes. Unknown errors are not retried by default. Core supplies its legacy retry classifier for compatibility.
- A failed cleanup prevents replay of that operation; the host remains responsible for isolating uncooperative operations. The generic executor drains siblings rather than releasing permits through an abandoned `Promise.race`.
- Observers are best effort. Validation, persistence and usage callbacks are business operations and must not silently become logging callbacks.
- JSON repair has one absolute deadline. Request adapters forward the fourth callback argument; existing three-argument callbacks remain source compatible but must cooperate to stop in-flight work.
- Reading Graph distinguishes validated empty extractions from failed fallbacks. All failed extractions fail the artifact; file cleanup cannot replace the originating failure.

## Verification and packaging

Runtime tests inject fetch, SSE interruption, quota responses, cancellation and broken observers. Existing core tests verify retry configuration and final-cause compatibility. Run workspace verify/tests/build and `smoke:pack-install`; runtime is part of release ordering and the local CLI install dependency closure. Private hosts stage the exact checkout, including runtime, rather than requiring an unpublished registry version.

## Capacity, candidates and quality

`CapacityPool` bounds active operations and queued callers. A `ResourceLease` retains a slot until host resources actually settle, even after cancellation returns to the caller. Uncooperative operations quarantine capacity; they cannot create an unlimited replacement stream. Cleanup has its own finite budget; a cleanup timeout prevents transport replay. `mapConcurrent` pulls one bounded window, drains cooperative siblings on first failure and closes its upstream on early consumption exit. `collectConcurrent` bounds pending work but intentionally materializes final results. Neither executor pretends a non-terminating host operation has stopped.

`CandidateAcceptance` defers cache publication until schema and asynchronous business validation accept a response. JSON repair rejects each invalid candidate. Summary compression retains revision candidates and publishes the selected revision only. The acceptance boundary is business validation, not a distributed transaction: later artifact persistence can still fail, and cache writes cannot be rolled back atomically with unrelated storage.

`QualityGate` separates accepted (including valid empty), skipped and failed fallback outcomes. A stage consisting entirely of failed fallbacks cannot publish a successful graph or summary. `QualityPolicy.allowFallback` controls partial fallback and `onOutcome` observes safe diagnostics. Core LLM options and chapter file execution expose this policy. Provider, cancellation and programming errors bypass content fallback.

## Usage and progress contracts

`UsageLedger` records real provider attempts, including incomplete SSE and later rejected candidates. Repeated cumulative usage snapshots update maxima, rather than adding tokens twice. Completed attempts fold into fixed-size totals; unresolved candidates have a finite capacity. Missing input/output usage is counted as unknown, not assumed zero consumption. Numeric token fields contain only known consumption. Accepted means validation accepted the candidate; rejected and unclassified attempts still count toward consumption. POST replay may incur additional charges.

Usage snapshots contain a monotonic sequence and version-1 totals. `onStatistics` is an awaited persistence port: its failure fails execution without triggering another provider request. Diagnostic `onEvent`/`onOutcome` sinks are best effort and cannot fail execution. Core and job expose these ports without depending on a control-plane billing schema.

`ProgressTracker` separates scope, phase, unit, attempt and candidate/accepted outcome. Duplicate or regressive events within that identity are ignored; totals remain monotonic. A unit total must never replace an operation total. Hosts must enforce owner identity and persist progress/usage atomically with their existing state protocol.
