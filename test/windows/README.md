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
