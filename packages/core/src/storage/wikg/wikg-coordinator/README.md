# Archive reader/settlement protocol

The owner row is both a liveness record and an intent to hold a native reader.
Registration and commit admission are serialized by coordinator SQLite
transactions. Registration checks both replacement and commit fences **before
opening any ZIP handle**, including validation and bounded manifest probes.
Low-level host ZIP/File operations outside these coordinator entry points remain
caller-coordinated; they are not implicitly turned into archive sessions.

## Phases

`archive_settlements` is optional derived coordination metadata. No row means
**reading**, including owners created by older binaries. A row with `completed=0`
means **drained/settling**: the source reader has successfully closed and all
SQLite leases have been released. The owner is still registered throughout
writer/rollback/cache cleanup. A close failure must not publish this phase or
unregister a possibly live native reader.

Only after rollback obligations and cache/workspace cleanup have completed does
the owner publish `completed=1`. Its remaining overlays can then be reaped even
while it is still registered. This final reap closes the race where simultaneous
closers otherwise each miss the other's last deferred obligation. A live drained
but incomplete owner's overlays are **not** adoptable: it can still roll back.

If another reading owner exists, physical settlement returns **deferred** without
taking entry locks or waiting for that callback. Already published overlays remain
the durable logical state. Waiting for the foreign owner to exit would deadlock
when its callback is itself awaiting the closing operation. A later drained
session, exclusive export/replacement, or stale-owner recovery settles those
overlays. A capability that is truly readonly cannot perform this recovery write;
a later writable access must do so. Physical ZIP bytes can therefore lag logical
writes while foreign readers remain active. Do not distribute raw bytes while
sessions remain active; SDK export drains and settles before copying them.
Export/replacement from an active callback on the same source is rejected before
requesting a drain, since waiting for that callback would be a self-deadlock.

## Lock order and generation

For settlement: check for foreign reader intents and acquire the archive commit
fence atomically, then take sorted entry write locks, verify SQLite leases are
drained, reread current overlays, rewrite the ZIP, and close source readers before
committing the target writer. Release entry locks before the commit fence. New
sessions and replacements cannot register inside this window. No reader is
closed/reopened merely to let another process commit: its token and native source
remain the same generation. Cache bytes built over dirty deferred overlays are
discarded instead of being published under an old physical mutation token.

Directory sessions retain the existing directory transaction/recovery lock; they
use the same owner phases but do not acquire ZIP handles.

Discarding an unchanged SQLite materialization requires a fresh digest while the
coordinator's `BEGIN IMMEDIATE` transaction excludes new lease admission and the
lease count is zero. A digest calculated before that transaction is insufficient:
a writer can checkpoint and release its lease without changing the overlay row.
Deleting based on that stale digest would discard the completed logical write.

## Failure and recovery

Before logical completion, callback/reader/commit failures preserve the existing
rollback rules. ZIP writer abort leaves old archive bytes intact. After completion,
a failed final reap is reported, but completed overlays remain durable and eligible
for recovery; they must not be rolled back after another settler may have adopted
them. Unregistration and stale-owner cleanup remove phase rows alongside leases
and fences. A dead settler's published overlays survive, while unpublished staging
files never become commit candidates. An owner whose reader cannot close remains
visible until host liveness proves it stale.

## Compatibility

The optional table is created by the existing coordinator derived-state bootstrap.
It changes no existing columns, archive entries, snapshots, Home payloads or schema
markers. Existing owners without rows remain conservatively reading, and existing
overlays retain their recovery semantics. Home v6, Archive v5 and format v1 need
no migration. This does not imply mixed-binary concurrency is safe: stop workers
from older releases before switching, because old writers do not honor the new
commit-admission fence. Never delete buffers containing pending logical writes.
