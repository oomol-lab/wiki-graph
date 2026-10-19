# Compatible asynchronous SQLite candidates

This continues [the native A/B investigation](sqlite-investigation.md). None of
these experiments changes the product dependency, Node engine, schema or native
distribution channel. Checked against published npm tarballs on 2026-10-19.

## Historical package audit

The audit extracted each published package and its embedded `sqlite3.c`, rather
than assuming that a version number proves the presence/absence of a backport.
`pre-UNC` below means the problematic `winIsUNCPath` function is absent, not that
runtime correctness is already established. `bad` means the function treats
extended local drives as UNC; `fixed` excludes them as in upstream a4691489.

| AppThreat versions (all 20 published versions) | SQLite | Classification |
| ---------------------------------------------- | ------ | -------------- |
| 6.0.0, 6.0.2, 6.0.3, 6.0.4, 6.0.5              | 3.50.0 | pre-UNC        |
| 6.0.6                                          | 3.50.1 | pre-UNC        |
| 6.0.7                                          | 3.50.2 | pre-UNC        |
| 6.0.8                                          | 3.50.3 | pre-UNC        |
| 6.0.9, 7.0.1                                   | 3.50.4 | pre-UNC        |
| 7.0.2                                          | 3.51.0 | bad            |
| 7.0.3                                          | 3.51.2 | bad            |
| 7.0.4, 8.0.0, 8.0.1                            | 3.52.0 | bad            |
| 8.0.2                                          | 3.53.0 | bad            |
| 9.0.0, 9.0.1, 9.0.2, 9.1.0                     | 3.53.4 | fixed          |

All 6.x–8.x manifests declare Node >=20 and N-API 9/10. Releases through 7.0.4
download GitHub prebuilds using `prebuild-install`; the 7.0.1 release actually
contains both N-API 9 and 10 binaries for Windows/macOS/Linux x64 and ARM64,
including Linux musl. Releases 8.x–9.x instead package eight binaries in npm
(Windows/macOS x64+ARM64, Linux x64+ARM64 glibc/musl). All 9.x manifests require
Node >=24, Electron >=35 and N-API 10. Older releases are not presumed maintained
security branches merely because their parent project is active.

Additional published packages inspected:

| Package                          | Embedded SQLite / classification | Installation / compatibility                                                                                               |
| -------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Official sqlite3 5.1.7           | 3.44.2 / pre-UNC                 | Async callbacks, N-API 3/6 GitHub prebuilds; same package/maintainer as current binding, but substantial engine downgrade  |
| @gristlabs/sqlite3 6.0.1-grist.1 | 3.51.3 / bad                     | Active Grist fork, Node >=20.17, N-API 3/6 Windows x64/ia32 and macOS/Linux x64/ARM64 prebuilds; no Windows ARM64 prebuild |
| @vscode/sqlite3 5.1.14-vscode    | 3.39.4 / pre-UNC                 | No binaries in npm tarball; install invokes node-gyp, not a compiler-free consumer replacement                             |
| @journeyapps/sqlcipher 6.0.0     | 3.51.3 / bad                     | Different encrypted engine; no binaries in npm tarball, install invokes node-gyp                                           |

Promise wrappers around sqlite3 retain its native engine and do not solve this
defect. Synchronous better-sqlite3, node:sqlite and WASM are not asynchronous
drop-ins; moving transactions to a new worker/backend remains a separate product
decision. A native package's declared N-API versions alone do not prove that its
published binary loads on Node 22.12 or an Electron host.

## Qualification procedure

Dispatch `pr-check.yml` with `compatibleDiagnostics=true`. The isolated jobs use
published binaries only: install with lifecycle scripts disabled, then invoke
`prebuild-install` explicitly, with **no compiler fallback**. 8.0.2 uses its
packaged binary. The native matrix retains all 12 path/alias/process cells and
25 waves, plus FTS5, bound values, BLOB, rollback and statement-error recovery.

Build/pack under the repository tooling's Node 22 (pnpm 11 requires >=22.13),
then switch to the SDK's actual minimum **22.12.0** without package-manager
cache discovery. npm installs only the packed SDK, with local tarball overrides
for its unpublished transitive workspace packages and an isolated SQLite
candidate override. No workspace symlink or direct core consumer import is used.

The packed fixture exercises CJS and ESM imports of SDK/node-platform/worker/
default-worker, duplicate-key rejection followed by integrity checks, real source
creation, queued offline FTS execution in a worker thread, repeated job event
appends, ZIP publication, and fresh-process FTS/event reads. It also runs using
an Electron executable in run-as-node mode. This tests native/entry loading and
worker behavior, **not** ASAR packaging, renderer sandbox or a packaged GUI.
The Electron runtime version is recorded; no new support floor is inferred.

An additional ephemeral-addon experiment runs all 105 Windows regressions with
the candidate's native binary. It remains distinct from product acceptance and
from packed testing of the candidate's own JS wrapper. Every artifact records
the actual commit; failures and installation/tooling failures are retained.

The first dispatch at c59face could not start the Node 22.12 experiments because
setup-node's pnpm cache discovery ran pnpm 11 on that runtime. The ed00928 run
still encountered automatic cache discovery after switching runtime. Neither is
native candidate evidence. The revised job disables that automatic cache only
for the runtime switch; it does not raise the consumer runtime requirement.

## Findings at 7449c03

On real Windows Node 22.12.0, official 5.1.7 (SQLite 3.44.2) and AppThreat 7.0.1
(SQLite 3.50.4) each passed all 12 native matrix cells, all 25 rounds per cell,
and the capability probes. AppThreat 8.0.2 (SQLite 3.53.0) loaded on the same
runtime but failed all four same-process extended/long cells with SQLITE_PROTOCOL
(8 passed / 4 failed). All cross-process cells passed in this bounded experiment.

The first packed AppThreat CJS consumer failed at database open with SQLITE*MISUSE:
esbuild's CJS namespace wrapper around require(ESM) adds a second default layer.
Database remains a named export, but OPEN*\* constants are only on the inner API;
the original SDK wrapper therefore produced flags=0. The minimal interop fix
unwraps that second layer before reading the flags. It changes neither the
production dependency nor any concurrency/path semantics.

Official 5.1.7 passed packed Node CJS/ESM creation, worker FTS and fresh-process
query/event verification (four cases). The supplemental Electron 33.4.11 CJS
attempt failed before SQLite use: Core requires @noble/hashes/legacy.js, an ESM
module, from CJS. Electron 33 uses Node 20, below the SDK's existing Node >=22.12
contract. This is not evidence of an SQLite or candidate-specific regression.
That failure remains in the run/artifact; the next experiment uses Electron
35.0.0, whose Node runtime meets the current contract. No Electron package
engine requirement is added or raised by this test selection.

All three native jobs and their JSON artifacts are under
[run 39212631406](https://github.com/oomol-lab/wiki-graph/actions/runs/39212631406):
official job 117929240227, AppThreat 7 job 117929240125, AppThreat 8 job 117929240056. Consumer failures are retained in the sqlite-consumer artifacts.
Neither incomplete packed qualification nor a green native matrix alone is
release acceptance. The full candidate-addon runs in this first dispatch were
not executed after consumer failures; subsequent diagnostics make them
independent so a wrapper failure cannot suppress necessary native investigation.
