# Linux workflow timeouts: investigation and regression contract

The original failure is [Full Regression on 4f9c977](https://github.com/oomol-lab/wiki-graph/actions/runs/39231772102/job/117991255926).
It failed **before** packed CLI E2E: two stalled-wikipage isolation cases hit
15 seconds and EPUB import/provenance hit 20 seconds. `ENOTEMPTY` occurred during
teardown. No `EPERM` or `SQLITE_PROTOCOL` appeared.

## Evidence, not a timeout increase

[Pre-fix Linux phase tracing](https://github.com/oomol-lab/wiki-graph/actions/runs/39239537784/job/118016732885)
reproduced all three timeouts after fixing teardown ownership. Standalone fixture
creation took 1.295 seconds; the first search during the stalled request took
6.915 seconds, and the next search 14.246 seconds. Searches finished, but each
subsequent operation grew slower. EPUB creation finished in 13.759 seconds;
later provenance reads pushed the combined workflow past 20 seconds. The repaired
teardown no longer removed a workspace while these operations were still active.

[Same-run Linux comparison](https://github.com/oomol-lab/wiki-graph/actions/runs/39240274309/job/118019146067)
used identical focused fixtures on three combinations:

| Product sources                  | SQLite binding         | First/second standalone search | Isolation cases |
| -------------------------------- | ---------------------- | ------------------------------ | --------------- |
| 5ca5238, before #784             | official 6.0.1         | 6.137 / 12.409 seconds         | both time out   |
| 27ee458, before this product fix | official 6.0.1         | 6.562 / 13.221 seconds         | both time out   |
| 27ee458, before this product fix | pinned AppThreat 7.0.1 | 6.458 / 12.451 seconds         | both time out   |

This comparison selects the three relevant cases (eight unrelated cases are
filtered, not acceptance evidence). All three variants retain the same 15/20
second limits. The EPUB case passes when run in isolation, but also timed out in
the broader pre-fix comparison. The broader experiment and its failures remain
available in [the initial investigation](https://github.com/oomol-lab/wiki-graph/actions/runs/39238789953/job/118014284966).
Diagnostic controls intentionally fail; a green diagnostic job means the
comparison ran, **not** that the tested product passed.

## Root cause and fix

Each `Database` and `DirectoryDocument` created its own host async context.
Their transaction/session callbacks enabled Node AsyncLocalStorage tracking, but
close/release did not disable it. In Node's async-hooks implementation, enabled
ALS instances remain tracked until `disable()`; see the
[Node 22 lifetime contract](https://nodejs.org/download/release/v22.18.0/docs/api/async_context.html#asynclocalstoragedisable).
Repeated short-lived coordinator connections thus made later Promise operations
progressively more expensive and retained contexts after resources closed. Node
24's newer async-context implementation hid this on the development machine.
This predates #784; the additional coordinator transactions increase exposure,
but switching between the two native bindings does not remove the defect.

The product fix releases each context at its resource boundary. A failed native
database close retains its context for retry; successful close disables once.
Document context cleanup still runs when file-store close fails. Host contexts
gain an **optional** synchronous `disable()` hook, preserving older custom hosts.
No SQLite binding, durability, reader fence, schema or runtime requirement changes.

For a local diagnostic on Node 24, propagate
`NODE_OPTIONS=--no-async-context-frame` to Vitest and its workers (passing the flag
only to the parent does not qualify the child). Before the fix, the two isolation
cases took 22.468 / 25.271 seconds and failed. After the fix, all eleven cases
passed in the same mode; the cases took 1.581 / 1.242 seconds and EPUB import
1.672 seconds. These macOS observations supplement, not replace, Linux acceptance.

## Regression/CI ownership

- `database-lifecycle.test.ts` asserts that 100 transaction contexts do not
  accumulate enabled trackers; it covers close retry, old hosts, document close
  failure and nested transactions across two independent databases. It tests
  ownership, not wall-clock speed or forced garbage collection.
- `regression-lifecycle.test.ts` runs a deliberately timed-out child Vitest
  fixture. The late write and finally complete before SDK-close/remove callbacks.
  Cleanup errors do not hide the original operation failure. Teardown joins the
  actual body, not the runner's timeout race, and can cancel pending wikipage I/O.
- `Linux archive workflow regressions` runs both full-regression files on every
  PR with JSON evidence. The gate requires both isolation cases and EPUB import,
  no missing/empty file, failed assertion, skipped case or todo. It does not
  substitute for the complete suite or the existing Windows jobs.
- Scheduled full regression no longer silently succeeds by skipping tests when
  main's commit date differs from the scheduler's date. Dispatch runs the selected
  ref; scheduled runs use the default branch. It runs full tests, build, then
  packed CLI E2E. A failing prerequisite cannot count as E2E success.

The existing 15/20-second limits remain unchanged. No reader-before-commit,
abort/old-data protection or long-path regression is removed. Release preparation
stays at the unpublished 0.9.6; Home v6, Archive v5 and format v1 do not change.
