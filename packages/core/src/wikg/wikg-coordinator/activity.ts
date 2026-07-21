import { cleanupStaleState, getNumber, withStateDatabase } from "./state.js";

export async function hasActiveArchiveOwnerOrSqliteLease(
  archiveKey: string,
  entryPath: string,
): Promise<boolean> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    const ownerCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM archive_owners WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const leaseCount = await state.queryOne(
      `
SELECT COUNT(*) AS count
FROM entry_sqlite_leases
WHERE archive_key = ?
  AND entry_path = ?
`,
      [archiveKey, entryPath],
      (row) => getNumber(row, "count"),
    );

    return (ownerCount ?? 0) > 0 || (leaseCount ?? 0) > 0;
  });
}

export async function hasActiveWorkspaceUse(archiveKey: string): Promise<boolean> {
  return await withStateDatabase(async (state) => {
    await cleanupStaleState(state);
    const ownerCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM archive_owners WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const leaseCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM entry_sqlite_leases WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );
    const lockCount = await state.queryOne(
      "SELECT COUNT(*) AS count FROM entry_locks WHERE archive_key = ?",
      [archiveKey],
      (row) => getNumber(row, "count"),
    );

    return (
      (ownerCount ?? 0) > 0 || (leaseCount ?? 0) > 0 || (lockCount ?? 0) > 0
    );
  });
}
