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
