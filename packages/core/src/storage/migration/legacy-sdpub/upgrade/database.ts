import type { Database } from "../../../../document/database.js";

export async function listTableNames(
  database: Database,
): Promise<ReadonlySet<string>> {
  const names = await database.queryAll(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `,
    undefined,
    (row) => String(row.name),
  );

  return new Set(names);
}

export async function listTableColumns(
  database: Database,
  tableName: string,
): Promise<ReadonlySet<string>> {
  const columns = await database.queryAll(
    `PRAGMA table_info(${quoteSqlIdentifier(tableName)})`,
    undefined,
    (row) => String(row.name),
  );

  return new Set(columns);
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
