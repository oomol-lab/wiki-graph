import { getNumber } from "../../../document/database.js";
import type { Document, ReadonlyDocument } from "../../../document/index.js";
import type { ArchiveIndexSettings } from "./types.js";

export async function readArchiveIndexSettings(
  document: ReadonlyDocument,
): Promise<ArchiveIndexSettings> {
  return await document.readDatabase(async (database) => {
    const row = await database.queryOne(
      `
        SELECT fts_embedded
        FROM archive_index_settings
        WHERE id = 1
      `,
      undefined,
      (value) => ({
        ftsEmbedded: getNumber(value, "fts_embedded") !== 0,
      }),
    );

    return row ?? { ftsEmbedded: false };
  });
}

export async function setFtsIndexEmbedded(
  document: Document,
  embedded: boolean,
): Promise<void> {
  await document.readDatabase(async (database) => {
    await database.run(
      `
        INSERT INTO archive_index_settings(id, fts_embedded)
        VALUES (1, ?)
        ON CONFLICT(id)
        DO UPDATE SET fts_embedded = excluded.fts_embedded
      `,
      [embedded ? 1 : 0],
    );
  });
}
