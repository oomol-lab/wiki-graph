import type { Document } from "../../../document/index.js";
import { SINGLE_ARCHIVE_INDEX_ID } from "./types.js";

export async function markDirtySearchIndexChapters(
  document: Document,
  chapterIds: readonly number[],
  options: { readonly archiveId?: number; readonly updatedAt?: number } = {},
): Promise<void> {
  if (chapterIds.length === 0) {
    return;
  }

  const archiveId = options.archiveId ?? SINGLE_ARCHIVE_INDEX_ID;
  const updatedAt = options.updatedAt ?? Date.now();
  const uniqueChapterIds = [...new Set(chapterIds)];

  await document.writeSearchIndexDatabase(async (database) => {
    await database.transaction(async () => {
      for (const chapterId of uniqueChapterIds) {
        await database.run(
          `
            INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(archive_id, chapter_id) DO UPDATE SET
              updated_at = excluded.updated_at
          `,
          [archiveId, chapterId, updatedAt],
        );
      }
    });
  });
}
