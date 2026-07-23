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
open/upgrade boundaries and covers archive entries such as `database.db` and an
embedded `fts.db`. It must not be reimplemented across query/list/search/evidence
business paths.

The v1 -> v2 archive upgrader removes the embedded archive `fts.db` as derived
search index data and preserves important archive content and the mutation token.
It must refuse active coordinator state for the target archive and non-`fts.db`
overlays, because those can represent uncommitted important data.

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
- `~/.wikigraph/staging/staging.sqlite`
  - coordinator overlays, entry locks, owners, sqlite leases, and commit locks.
- `~/.wikigraph/staging/library/<library-id>/index/fts.db`
  - library aggregate search index SQLite.
- `~/.wikigraph/staging/work/<archiveKey>/fts.db`
  - archive coordinator external search index cache workspace referenced by
    `entry_overlays(entry_path = 'fts.db')`.

For v1 -> v2, derived home data is deleted or invalidated: query/search caches,
external cache, GC state, build queue SQLite/cache when safe, library aggregate
indexes, and external archive search index overlays/workspaces for `fts.db` only.
The upgrader must not delete non-`fts.db` overlays and must block when active GC,
build job, worker lease, coordinator owner/lock/sqlite lease/commit lock, or
non-`fts.db` overlay state is present.

Pure information commands such as `wg --version` and help rendering must not open
home SQLite and must not trigger schema upgrade.

## Module Boundary

`document` owns low-level SQLite/shared-state opening helpers and the home gate
implementation used by those helpers. `storage/schema-upgrade` owns archive
schema orchestration and re-exports the home schema functions for the public API.
This keeps low-level shared-state database code from depending upward on the
storage archive upgrader while preserving one public schema-upgrade import path
for callers.
