# Schema Upgrade Maintenance

This document is for maintainers who change persistent Wiki Graph data layouts.
Schema versions are storage compatibility markers. They are separate from the
published `wg --version` package version: a package release may leave schema
versions unchanged, and a schema version bump may happen inside any package
version that changes persisted archive or home state.

## When To Bump A Schema Version

Bump a schema version when a newer checkout can no longer safely read or reuse
state written by an older checkout without a controlled migration or invalidation.
This includes important table/column/constraint changes, changed semantics of
stored payloads, or derived SQLite state that could be mistaken for current data.

Do not use scattered ad hoc checks in CLI commands or business functions as a
replacement for a schema upgrader. The gates must stay at storage opening
boundaries so normal operations either see current state or fail before touching
unsafe state.

## Upgrader Shape

Every bump must add exactly one adjacent upgrader path, such as `N -> N+1`.
Do not skip versions and do not let a later version silently reinterpret older
state. Each upgrader needs a fixture or focused regression test that proves:

- important data is migrated;
- derived data is deleted or invalidated by default instead of compatibility
  migrated;
- dangerous active state blocks the upgrade before writes happen;
- future schema versions are rejected;
- the completion marker is written only after the upgrader succeeds.

Important data must survive upgrade failure. If an upgrader fails, it must not
write the target schema marker.

## Archive Gate

Archive schema belongs to each `.wikg` file. The archive gate runs at archive
open/upgrade boundaries and covers archive entries such as `database.db`, an
embedded `index.db`, and legacy embedded `fts.db`. It must not be reimplemented
across query/list/search/evidence business paths.

The v1 -> v2 archive upgrader removes embedded archive `index.db` and legacy
`fts.db` as derived search index data and preserves important archive content
and the mutation token.

The v2 -> v3 archive upgrader separates index artifacts from index caches. It
keeps important archive data, rebuilds chapter FTS index artifacts from the
archive source/summary/object data already present in `database.db`, drops the
old `archive_index_settings` table, and deletes embedded `index.db` / legacy
`fts.db` caches. It does not create embedding artifacts, because older schemas
never stored them as important data.

The v3 -> v4 archive upgrader adds the source provenance schema to
`database.db`: `source_artifacts`, `source_locators`, `source_text_maps`, and
their indexes. Each source artifact stores its full SHA-256 digest plus a
unique archive-local short UID used by public handles. Locator fragments are
persisted canonically and are unique within each source artifact. It preserves
existing source/summary text and structured archive data; provenance tables are
initialized in the extracted upgrade workspace and the resulting database is
written back only by the explicit archive upgrader.

The v4 -> v5 archive upgrader adds `character_offset` and `character_length`
to `text_sentence_records` and reconstructs them from the preserved source and
summary streams. These code-point positions let range retrieval return source
locators without scanning every byte before a late sentence. The embedded
search index remains derived data and is invalidated during the archive rewrite.

Archive upgraders must refuse active coordinator state for the target archive
and non-search-index overlays, because those can represent uncommitted important
data. This check uses the current host-neutral coordinator state in
`tmp/wikg-coordinator.sqlite`; an in-process upgrade queue is not a substitute
for the durable check. Derived `index.db` / `fts.db` overlays may be discarded
after the archive rewrite commits.

## Home Gate

Home schema belongs to the machine-level Wiki Graph state directory, normally
`~/.wikigraph`. The home gate runs before opening home/shared/runtime SQLite
state and before derived index SQLite state that does not use shared-state
opening helpers.

The current home gate coverage is explicit. Keep this list synchronized with
code and tests when adding new home SQLite files:

- `~/.wikigraph/core.sqlite`
  - config sections, schema versions, library registry, library metadata,
    library archive membership, and library locks.
- `~/.wikigraph/cache/search-sessions.sqlite`
  - query search sessions, results, dictionaries, evidence events, and hit rows.
- `~/.wikigraph/cache/continuation-cursors.sqlite`
  - continuation cursor payloads and expiry state.
- `~/.wikigraph/cache/cache.sqlite`
  - external wikipage/QID/disambiguation cache.
- `~/.wikigraph/jobs/job.sqlite`
  - build jobs and build worker lease state.
- `~/.wikigraph/tmp/gc.sqlite`
  - GC locks.
- `~/.wikigraph/tmp/wikg-coordinator.sqlite`
  - current host-neutral coordinator overlays, entry locks, owners, sqlite
    leases, and commit locks.
- `~/.wikigraph/staging/staging.sqlite`
  - legacy v3 coordinator state, inspected only by the home upgrader.
- `~/.wikigraph/staging/library/<library-id>/index/index.db`
  - library aggregate search index SQLite.
- the host-provided document store
  - `.wikg-work` coordinator snapshots, `.wikg-cache` search caches, and
    abandoned `.wikg-session-*` / `.wikg-upgrade-*` workspaces.

For home schema upgrades, derived home data is deleted or invalidated:
query/search caches, external cache, GC state, build queue SQLite/cache when
safe, library aggregate indexes, external archive search index
overlays/workspaces for `index.db` or legacy `fts.db`, and orphaned SQLite
materialization cache overlays whose archive file no longer exists. The v2 -> v3
home upgrader uses the same cleanup boundary because the index-cache semantics
changed. A home upgrader must block before cleanup when library/state/GC locks,
a build worker lease, or coordinator owners are still active. Queued, paused,
or otherwise unfinished job rows without a live worker are inactive derived
state and do not block migration. Orphaned
cross-version overlays are rollback state, not a reason to replay a partially
completed operation against an archive.

Pure information commands such as `wg --version` and help rendering must not open
home SQLite and must not trigger schema upgrade.

The v3 -> v4 home upgrader is the persistence boundary for the host-neutral
runtime refactor. It renames `libraries.folder_path` to
`libraries.folder_identity` and asks the host resource adapter to resolve every
legacy stored directory reference, then persists only each resulting opaque
`Directory.identity`. Config sections, library ids/default status, library
metadata, and `library_archives` membership rows remain unchanged. The archive
schema remains v4 and no `.wikg` is rewritten by this home migration.
Hosts that need to accept a v3 home implement the resource adapter's
`resolveLegacyDirectory` hook; this keeps legacy location syntax outside Core's
normal file and directory operations.

Before changing the registry or deleting derived state, the upgrader rejects
fresh library/state/GC locks, an active build worker lease, and live
legacy or current coordinator owners. Once those checks pass, cross-version
coordinator state is rolled back: legacy/current coordinator databases and
their workspaces are discarded, including non-derived overlays, so the last
atomic `.wikg` commit stays authoritative. Search/cache/index state and inactive
job queue/work/cache state are likewise invalidated. The v4 marker is written
last; a failure retains the prior marker and the migration can be retried. A
second successful run is a no-op.

Search index caches also carry their own `search_index_state.version`. Opening a
cache whose version is missing, unreadable, or different from the current search
index version must delete that cache and treat it as missing. Write paths may
then recreate the cache from artifacts; read paths must report the missing-cache
state instead of querying stale SQLite.

After a home `core.sqlite` file is confirmed current, the home gate may memoize
that result inside the current process for hot gated access. The memo must be
bound to both the resolved `core.sqlite` path and a file fingerprint (`dev`,
`ino`, `mtimeMs`, `size`), so replacing, deleting/recreating, or rewriting the
same path forces the next gated access to re-read the home schema version before
opening other home SQLite state.

## Product Upgrade Entry Points

User-visible upgrade targets are limited to home, standalone archive, library,
and legacy sdpub inputs. Internal SQLite files such as search sessions, job
state, staging state, and library `index.db` are implementation details of the
home or library target and must not become CLI targets.

- `wg maintenance upgrade home` explicitly upgrades home state. This command
  bypasses the ordinary home preflight so an old schema can enter its own
  upgrade flow; `~/.wikigraph` and its shell-expanded configured path are also
  accepted as aliases. Real CLI
  commands also run a centralized home preflight before touching local state;
  `wg --version`, `wg --help`, `wg help ...`, and other pure help rendering paths
  remain rescue paths and do not create or upgrade home.
- `wg maintenance upgrade <archive.wikg>` and archive URI forms upgrade a
  standalone archive in place. Normal archive access only checks schema and
  reports `wg maintenance upgrade <archive>` when old data is found; it must not
  silently rewrite user archives.
- `wg maintenance upgrade wikg://lib` and
  `wg maintenance upgrade wikg://lib/<lib-id>` upgrade a registered library
  under the library write lock. The command clears rebuildable derived library
  state and only visits archives registered in `library_archives`; it does not
  scan the folder for unmanaged `.wikg` files.
- `wg maintenance upgrade <path.sdpub> [--output <path.wikg>]` is the formal
  sdpub migration entry. `wg legacy migrate` remains as a deprecated alias and
  must share the same implementation.

## Module Boundary

`document` owns low-level SQLite/shared-state opening helpers and the home gate
implementation used by those helpers. `storage/schema-upgrade` owns archive
schema orchestration and re-exports the home schema functions for the public API.
This keeps low-level shared-state database code from depending upward on the
storage archive upgrader while preserving one public schema-upgrade import path
for callers.
