import { Database } from "../../../../document/database.js";
import { listTableColumns, listTableNames } from "./database.js";

export async function migrateLegacyDatabase(
  databasePath: string,
): Promise<void> {
  const database = await Database.open(databasePath);

  try {
    await migrateKnowledgeEdges(database);
    await migrateSerialDocumentOrder(database);
  } finally {
    await database.close();
  }
}

async function migrateKnowledgeEdges(database: Database): Promise<void> {
  const tables = await listTableNames(database);

  if (tables.has("reading_edges")) {
    return;
  }
  if (!tables.has("knowledge_edges")) {
    return;
  }

  await database.run(`
    ALTER TABLE knowledge_edges
    RENAME TO reading_edges
  `);
}

async function migrateSerialDocumentOrder(database: Database): Promise<void> {
  const columns = await listTableColumns(database, "serials");

  if (!columns.has("document_order")) {
    await database.run(`
      ALTER TABLE serials
      ADD COLUMN document_order INTEGER NOT NULL DEFAULT 0
    `);
  }

  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_serials_document_order
    ON serials(document_order, id)
  `);
}
