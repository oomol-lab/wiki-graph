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

Manually dispatch `pr-check.yml` on the pushed branch. Dispatch-only diagnostic
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
- This source difference is a hypothesis until the actual source-control and
  source-patched Windows results are compared. Neither a source diff nor an
  unrelated successful macOS query proves causation.

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
