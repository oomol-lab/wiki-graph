# Native SQLite investigation

This is a diagnostic experiment, separate from Windows product acceptance.
The normal **Windows Archive Coordination** job still uses the unchanged
published dependency and retains every failing cold-readonly case.

## Reproduction and A/B method

`scripts/diagnose-windows-sqlite.mjs` imports only Node built-ins and the selected
SQLite package, never Wiki Graph. Each of 12 cells has a fresh file/process:

- ordinary local drive, explicit extended drive, and extended local drive with
  physical filename longer than 280 characters;
- identical filename or alternating filename-case aliases;
- five concurrent connections in one process or five independent processes.

The writer creates a real WAL database and closes. Readers do 25 waves of
open/query/close. Every connection closes even after errors; all siblings settle
before the error is recorded. A failed wave terminates that cell, without retry,
and the other cells still run. Each cell checks committed data, integrity and
deletion/handle release. Child-process IPC coordinates the cross-process waves.
This isolates cold reopening; the separate product tests retain active WAL
read/write and killed-writer recovery.

The JSON records Node/package/native SQLite version and source ID, binary hash,
actual filename and physical length, completed waves and exact native errors.
The final experiment also probes FTS5, bound values, blobs, rollback and recovery
after a failed statement. A diagnostic failure exits nonzero; it never counts as
acceptance success.

Manually dispatch `pr-check.yml` on the pushed branch with
`gh workflow run pr-check.yml --ref <branch> -f nativeDiagnostics=true`.
The input defaults to false so normal PR/manual checks do not run intentionally
failing old-binding controls. Dispatch-only diagnostic
jobs compare the published prebuild with an isolated source control and the same
source with **only** `winIsUNCPath` replaced. Both source builds use the same
package, toolchain and flags. The exact replacement is asserted before building.
Node-gyp 13.1.0 supports the runner's Visual Studio 2026; the first experiment's
12.0.0 failed toolchain detection and is not A/B evidence.

Only the patched job can copy its experimental addon into its ephemeral checkout
and run the complete Windows regression set. Its artifact is deliberately named
`sqlite-patched-regressions`, distinct from `windows-regressions` from the product
job. No custom addon enters the lockfile, npm package, release workflow or user
installation. The candidate package is likewise installed in a temporary root.

## Root-cause references

- Current `sqlite3@6.0.1` bundles SQLite 3.52.0; npm `latest` is still 6.0.1
  (checked 2026-10-19). Upstream's pending
  [#1858](https://github.com/TryGhost/node-sqlite3/pull/1858) concerns replacing
  withdrawn 3.52.0 with 3.51.3, not delivering the later Windows fix.
- SQLite's [2429af2](https://github.com/sqlite/sqlite/commit/2429af2e0ce2e4c643786f8d2533f79d974e3270)
  (2026-06-12, Fossil `a4691489`) excludes local DOS-device drive names from
  UNC SHM locking. It is present in 3.53.4 and 3.54.0, but not 3.52.0 or
  3.53.0. The isolated patch uses that function, not a wholesale SQLite upgrade.
- The first controlled Windows experiment at commit
  `5d4af6a49dd11c201b7b1bafbfb52032a7e29045` measured
  [prebuilt: 9 passed / 3 failed](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/job/117919608110),
  [source control: 9 passed / 3 failed](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/job/117919608079),
  and [source patched: 12 passed / 0 failed](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/job/117919607865).
  All 12 matrix cells executed. All three bindings reported SQLite 3.52.0 and
  source ID `2026-03-06 16:01:44 557aeb43869d3585137b17690cb3b64f7de6921774daae9e56403c3717dceab6`.
  Ordinary files measured 70 characters, long files 302 before the device prefix.
  Failures were `SQLITE_PROTOCOL` in single-process extended/long cells, with
  both same-name and case-alias failures observed. No cross-process cell failed
  within 25 waves. Exactly which single-process wave failed varied; passing one
  bounded cell does not imply that spelling is immune.
  Artifacts: [prebuilt](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/artifacts/12166767360),
  [source control](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/artifacts/12167137457),
  [source patched](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/artifacts/12166957942).
  This isolates the native path-classification defect from Wiki Graph's own
  adapter/coordinator. It does not establish real SMB behavior or certify a
  published replacement binding.

## Subsequent Windows evidence

The expanded experiment at commit
`d6dddcaa5547eebaa320c5f45eb4f3192bfc745b` added the capability probes, a packaged
async candidate, and complete regressions with the isolated patched addon:

| Binding                                                        | Native matrix passed / failed | Job                                                                                            | JSON artifact                                                                                    |
| -------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Published sqlite3 6.0.1 prebuild                               | 10 / 2                        | [prebuilt](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445574)  | [report](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12167451847) |
| Unchanged sqlite3 6.0.1 source build                           | 9 / 3                         | [control](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445741)   | [report](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12167775936) |
| Same source, winIsUNCPath patch only                           | 12 / 0                        | [patched](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445734)   | [report](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12166758278) |
| Packaged @appthreat/sqlite3 9.1.0, Node 24.21.0, SQLite 3.53.4 | 12 / 0                        | [candidate](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445826) | [report](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12167551373) |

Every native-matrix cell ran; none was skipped. All four bindings passed the
FTS5/parameters/BLOB/rollback/error-recovery probes. The same-process
extended/long failures remain `SQLITE_PROTOCOL`; no cross-process failure was
observed in the bounded matrix.

The unchanged production binding's
[Windows Archive Coordination job](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445646)
passed all **105 assertions / 9 files, 0 failures, 0 skips, 0 todos**
([JSON](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12167312476)).
The previous production run at 5d4af6a was **104 passed / 1 failed / 0 skips/todos**
([job](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/job/117919608084),
[JSON](https://github.com/oomol-lab/wiki-graph/actions/runs/39209501670/artifacts/12167840724));
its sole failure was the extended-drive cold-readonly case. Do not interpret the
later green production job as a repair: the native-only prebuilt job at the
**same commit** still fails. This is an intermittent native race, and both
failing and passing evidence are retained. Runs were expanded for diagnosis,
not repeated until a green result could be selected.

The Linux quality, PR test and packed E2E/install/publish-dry-run jobs at d6dddca
passed independently. These do not establish Windows behavior. No Electron
packaged-app or actual SMB I/O acceptance is claimed.

The [patched-addon regression job](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/job/117921445734)
also completed with **105 passed / 0 failed / 0 skipped / 0 todo**
([JSON](https://github.com/oomol-lab/wiki-graph/actions/runs/39210133494/artifacts/12168125290)).
The injection log records SHA-256
`fb8d12f26d94cf23e9455a29cf7c19431d055476e103eef800a47d033723054e`,
matching the isolated patched native-matrix report. Thus the full suite actually
used that experimental addon, not the original prebuild.

| Requirement / complete file                                                                                                                 | Passed in each d6dddca full Windows job |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------: |
| Reader-before-commit, abort, old ZIP/log preservation, native statement release, long-path access — node-platform.test.ts                   |                                      34 |
| Opaque lifecycle forwarding and both close/commit failure + successful retry scenarios — opaque-file-adapter.test.ts                        |                                       7 |
| Archive/cache settlement, abort, cleanup failure, token generations — wiki-graph-archive-file.test.ts                                       |                                      24 |
| Cross-process disjoint writes, owner drain, concurrent close, interrupted settlement/reaping — archive-coordination.test.ts                 |                                      12 |
| Probe registration before ZIP open, failed-close owner retention, admission fence, compatibility/adoption — settlement-coordination.test.ts |                                       5 |
| Public SDK operations, export fence and reentrant rejection — delivery.full-regression.test.ts                                              |                                      14 |
| Public SDK source/FTS/job events/ZIP and fresh-process query — sdk-workflow.test.ts                                                         |                                       1 |
| Active WAL, >260 path, process interruption/recovery/integrity/continued writes/handle release — wal-recovery.test.ts                       |                                       3 |
| Drive/extended/UNC conversion contracts, no SMB I/O claim — path-contract.test.ts                                                           |                                       5 |

The standalone candidate matrix is not a full SDK consumer/Electron acceptance
run. No published binding was changed, and all product code remains identical
to c766775. The later evidence/opt-in-dispatch documentation commit is not
misrepresented as the tested d6dddca commit.

## Installable alternatives (checked 2026-10-19)

| Candidate                                 | Runtime/API and FTS                                                                                                              | Distribution and consequence                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official `sqlite3@6.0.1`                  | Async libuv callbacks, Node >=20.17, FTS5; SQLite 3.52.0                                                                         | Official N-API 3/6 GitHub prebuilds include Windows x64, not Windows ARM64. No corrected official release currently available. A pnpm source patch cannot repair the downloaded binary.                                                                                                                                      |
| `@vscode/sqlite3@5.1.14-vscode`           | Microsoft fork, callback API; source config SQLite 3.39.4                                                                        | Published install script is `node-gyp rebuild`. Not a compiler-free drop-in for our consumers, despite its inherited binary configuration.                                                                                                                                                                                   |
| `@appthreat/sqlite3@9.1.0`                | Independent AppThreat-maintained async fork; callback API plus promises; Node >=24, Electron >=35, N-API 10; SQLite 3.53.4, FTS5 | npm tarball contains macOS/Linux/Windows x64+ARM64 prebuilts (glibc/musl on Linux). ESM default and named exports; Node require-ESM and SDK CJS/worker packaging need full consumer verification. Must accept new maintainer/API semantics and Node floor. Older 8.0.2 keeps Node >=20 but bundles 3.53.0, lacking this fix. |
| `better-sqlite3@13.0.3`                   | Node >=22, N-API 10, SQLite 3.53.4, FTS5; synchronous API                                                                        | npm tarball contains eight platform prebuilts, including Windows x64+ARM64. Requires a real async worker design for this SDK; wrapping synchronous calls in promises would still block Electron and can deadlock transaction progress.                                                                                       |
| Built-in `node:sqlite`                    | Synchronous `DatabaseSync`; SQLite version follows Node/Electron                                                                 | No addon download, but Node 22.x currently bundles 3.51.3. Runtime coupling and worker adaptation remain; not an async drop-in or a guaranteed fixed SQLite version.                                                                                                                                                         |
| `@libsql/client@0.18.0` / `libsql@0.5.28` | Different local/remote client, transaction/value API                                                                             | Prebuilt optional platform packages include Windows x64 but not Windows ARM64. Larger engine/API change; no evidence here of equivalent long-path WAL behavior. Not recommended for this narrowly scoped repair.                                                                                                             |

N-API 10 itself requires Node >=22.14.0 (or >=23.6.0), per the
[Node version matrix](https://nodejs.org/docs/latest/api/n-api.html#node-api-version-matrix).
Thus even better-sqlite3's broad `>=22` manifest is not sufficient to preserve
Wiki Graph's current >=22.12.0 floor. Electron must expose the required N-API,
and its packager must retain/unpack the platform addon; Node loading alone does
not certify an Electron distribution.

Both AppThreat 9.1.0 and better-sqlite3 13.0.3 were installed with
`--ignore-scripts` in a temporary directory on macOS Node 24.17.0. Both loaded
their packaged native addon, reported SQLite 3.53.4, executed a real FTS5 MATCH
query, and closed. That verifies installation/FTS on that host only, not Electron
or Windows concurrency. Package manifests, binding.gyp and actual installed
prebuild files were checked rather than assuming inherited README text is current.

Changing the default backend or runtime floor requires a product decision and
full Node/Electron, CJS/ESM/worker, number/blob/error/statement, readonly, WAL,
schema/export and packed-consumer regression. No Home/Archive schema bump follows
merely from changing the binding; file-format compatibility must still be tested.
No production backend or release/distribution channel is changed by this experiment.

## Compatible-runtime investigation

The initial recommendation compared only recent candidates and was too narrow.
It did not establish that compatible historical async releases were unavailable.
See the complete [historical audit and compatible-runtime experiments](sqlite-compatibility.md).
Engines predating the UNC locking change are tested, rather than dismissed for
lacking the later fix. The new investigation preserves Node >=22.12, checks
published prebuilds without compiler fallback, and adds packed CJS/ESM consumers
and real offline FTS workers, separately from the original Node 24 experiment.

AppThreat 9.x is not recommended for the present runtime contract. Besides its
Node >=24 manifest, its extended constraint error codes need adapter review;
for example a duplicate primary key reports `SQLITE_CONSTRAINT_PRIMARYKEY`
instead of the current `SQLITE_CONSTRAINT`. Neither a new native distribution
channel nor a default-backend/runtime-floor change is authorized by diagnostic
qualification. Full acceptance must use the actual chosen product dependency,
not an addon injected only into an experiment.
