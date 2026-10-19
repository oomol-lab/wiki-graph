# Windows archive acceptance

The **Windows Archive Coordination** PR job runs
`node scripts/check-windows-regressions.mjs` on `windows-latest`.
It can also be run before a PR exists with
`gh workflow run pr-check.yml --ref <pushed-branch>`; the same job and report gate
apply to both triggers.
It runs complete files from `vitest.windows.config.ts`, including every
`test/windows/**/*.test.ts`. There is no test-name filter. The report gate fails
on missing required files, empty files, failures, skips or todo cases; this also
catches an accidental `-t`/`.only` filter. The JSON report is uploaded as the
`windows-regressions` artifact even when the job fails. The verbose job log gives
the individual case names and the final pass/skip counts.

| Requirement                                                                                                                      | Regression evidence in that job                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZIP sources close before commit; failed release aborts publication                                                               | Full `node-platform.test.ts` and `wiki-graph-archive-file.test.ts`                                                                                    |
| Opaque hook forwarding, failure propagation, old bytes and successful retry                                                      | Full `opaque-file-adapter.test.ts`, including `forwards ZIP commit lifecycle hooks through opaque files` and both `preserves opaque ZIP bytes…` cases |
| Event-log append failure leaves original intact and permits retry                                                                | Full `node-platform.test.ts` append cases                                                                                                             |
| Queue, FTS generation, multiple event appends, ZIP writeback, new-process query                                                  | `sdk-workflow.test.ts`: real public SDK and real local queue worker, no mocks/providers/network                                                       |
| Active read snapshot across a writer commit; killed writer with pending transaction; fresh-process recovery and continued writes | `wal-recovery.test.ts`: ordinary, extended drive and >260-character paths, asserted WAL mode, data, integrity and sidecar cleanup                     |
| Ordinary/extended drive and UNC/extended UNC conversion                                                                          | `path-contract.test.ts`: filesystem-boundary probes only, no SMB I/O                                                                                  |
| Archive session/lease recovery, replacement waits for readers                                                                    | Full `archive-coordination.test.ts` and SDK delivery suite                                                                                            |
| Reading/drained/completed owner phases, admission fence, old coordinator state, concurrent close and dead-settler recovery       | `settlement-coordination.test.ts`, `archive-coordination.test.ts` and SDK export/drain test                                                           |

The SDK workflow invokes the public source SDK through `tsx` in independent
processes. It is an SDK end-to-end workflow, **not a packed CLI acceptance test**.
The existing Ubuntu packed CLI suite remains a separate job. The tests use
isolated temporary roots and never the developer's real Home or global CLI.
IPC barriers, not scheduling sleeps, coordinate the new WAL test. The writer
stays alive while the reader pins a transaction; after a second committed write,
an uncommitted insert is interrupted by terminating the writer without close.
A fresh process must see only committed rows and successfully write again.
No explicit checkpoint or switch to DELETE is used to hide recovery failures.
The Node adapter suite also retains the older concurrent readonly reopen stress
case after the last writer closes; it is separate from active WAL recovery.
Concurrent reader groups await all cleanup before propagating an error, so a
temporary-directory unlink failure cannot obscure the original SQLite failure.
The cold-readonly stress case retains 25 groups of five readers and mixes case
aliases, on both long and explicitly extended drive paths; it is not replaced by
a warm-writer scenario.

## Native SQLite defect and binding qualification

The production-source Windows run at
[c766775](https://github.com/oomol-lab/wiki-graph/actions/runs/39195159000/job/117876312322)
passed the Archive protocol and active WAL regressions but failed cold readonly
reopen with `SQLITE_PROTOCOL` (102 passed, 1 failed, no skips/todos). Keep that
failure visible. The published `sqlite3@6.0.1` package bundles SQLite 3.52.0, whose
[`winIsUNCPath`](https://github.com/sqlite/sqlite/blob/version-3.52.0/src/os_win.c)
classifies namespaced local drives as UNC; the
[3.54.0 implementation](https://github.com/sqlite/sqlite/blob/version-3.54.0/src/os_win.c)
explicitly excludes them. The standalone reproduction, controlled source A/B
experiment, and installable binding comparison are documented in
[sqlite-investigation.md](./sqlite-investigation.md). Patched diagnostic builds
are not evidence that the unchanged product dependency passes acceptance.
The [compatible binding qualification](sqlite-compatibility.md) records Node
22.12 / current Node 22, Electron, packed worker, existing-archive and historical
prebuild evidence, including failures. At code SHA 515397c the default binding
still fails two cold readonly cases (104 passed / 2 failed), while isolated
AppThreat 7.0.1 N-API 9/10 runs each pass all 106 cases without skips or todos.
Those historical runs were candidate experiments. The approved product now pins
`npm:@appthreat/sqlite3@7.0.1` (SQLite 3.50.4), without changing Node >=22.12,
Home/Archive schemas or introducing a project-owned native distribution channel.
Later 7.x versions contain the native defect; keep the pin exact. A historical
release does not imply a separately maintained security branch.

The ordinary **Windows Archive Coordination** job tests the actual product
dependency. Two **Windows packed SDK Node … and Electron** jobs additionally
install the SDK tarball without any SQLite dependency override or injected addon,
assert the exact package/engine and error codes, and run eight CJS/ESM workflow
cases per Node 22.12 / current Node 22, including Electron 35 run-as-node and
real FTS workers. `sqlite-product-consumer-*` artifacts record the actual SHA,
package, runtime and results. This is not GUI/ASAR packaging certification.

Do not hide this by keeping a writable anchor, forcing DELETE/checkpoint cleanup,
using `immutable` or nolock VFSes, or serializing every native call in JavaScript.
The latter can prevent one connection's COMMIT from running while another holds
that JS gate inside SQLite's busy wait. Experiments with eager header priming and
JS native-call gates were withdrawn rather than changing transaction concurrency.
The Node adapter retains #346's short/long path policy unchanged.

Local diagnostic run on any OS:

```sh
pnpm exec vitest run --config vitest.windows.config.ts --reporter=verbose
```

On macOS/Linux the four Windows path-contract cases are explicitly skipped,
and drive-prefix behavior is not exercised. This is **not Windows evidence**.
The acceptance wrapper refuses to run on a non-Windows host. Its `--check-report`
mode validates saved JSON only, and is used by gate unit tests; it does not run
or certify a Windows workflow.

UNC probes verify spelling conversion and preservation only. No real SMB share
is provisioned, and network-filesystem SQLite/WAL support is **not validated or
promised**. Windows job URLs and actual pass/skip counts belong in the PR and
issue delivery report, not fabricated from a local run.
