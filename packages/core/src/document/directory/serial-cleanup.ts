import { isNodeError } from "../../utils/node-error.js";
import type { Database } from "../database.js";
import type {
  GraphBuildParameterStore,
  ObjectMetadataStore,
  SerialStore,
} from "../stores/index.js";
import type { TextStreams } from "../text-streams/index.js";
import {
  compareNumberDescending,
  type DirectoryDocumentContext,
} from "./context.js";
import type { DocumentFileStore } from "./types.js";

export async function rollbackDocumentContext(input: {
  readonly context: DirectoryDocumentContext;
  readonly deleteSerialResources: (serialId: number) => Promise<void>;
  readonly fileStore: DocumentFileStore;
}): Promise<void> {
  await rollbackOwnedSerials(
    input.context.listOwnedSerialIds(),
    input.deleteSerialResources,
  );
  await rollbackCreatedFiles(
    input.fileStore,
    input.context.listCreatedFilePaths(),
  );
}

export async function deleteSerialResources(input: {
  readonly database: Database;
  readonly deleteSummary: (serialId: number) => Promise<void>;
  readonly graphBuildParameters: GraphBuildParameterStore;
  readonly metadata: ObjectMetadataStore;
  readonly serialId: number;
  readonly serials: SerialStore;
  readonly textStreams: TextStreams;
}): Promise<void> {
  await input.metadata.deleteChapterSubtree(input.serialId);
  await deleteSerialGraphRecords({
    database: input.database,
    metadata: input.metadata,
    serialId: input.serialId,
  });
  await input.database.transaction(async () => {
    await input.database.run(
      `
        DELETE FROM serial_states
        WHERE serial_id = ?
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM serials
        WHERE id = ?
      `,
      [input.serialId],
    );
  });

  await input.textStreams.getSerial(input.serialId).delete();
  await input.deleteSummary(input.serialId);
  await input.serials.bumpChaptersRevision();
  await input.graphBuildParameters.deleteUnreferenced();
}

export async function deleteSerialGraphRecords(input: {
  readonly database: Database;
  readonly metadata: ObjectMetadataStore;
  readonly serialId: number;
}): Promise<void> {
  await input.database.transaction(async () => {
    await input.database.run(
      `
        DELETE FROM mention_link_evidence_sentences
        WHERE link_id IN (
          SELECT mention_links.id
          FROM mention_links
          INNER JOIN mentions AS source_mentions
            ON source_mentions.id = mention_links.source_mention_id
          INNER JOIN mentions AS target_mentions
            ON target_mentions.id = mention_links.target_mention_id
          WHERE source_mentions.chapter_id = ?
            OR target_mentions.chapter_id = ?
        )
      `,
      [input.serialId, input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM mention_links
        WHERE source_mention_id IN (
          SELECT id
          FROM mentions
          WHERE chapter_id = ?
        ) OR target_mention_id IN (
          SELECT id
          FROM mentions
          WHERE chapter_id = ?
        )
      `,
      [input.serialId, input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM mentions
        WHERE chapter_id = ?
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM snake_edges
        WHERE from_snake_id IN (
          SELECT id
          FROM snakes
          WHERE serial_id = ?
        ) OR to_snake_id IN (
          SELECT id
          FROM snakes
          WHERE serial_id = ?
        )
      `,
      [input.serialId, input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM snake_chunks
        WHERE snake_id IN (
          SELECT id
          FROM snakes
          WHERE serial_id = ?
        )
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM snakes
        WHERE serial_id = ?
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM sentence_groups
        WHERE serial_id = ?
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM reading_edges
        WHERE from_id IN (
          SELECT id
          FROM chunks
          WHERE serial_id = ?
        ) OR to_id IN (
          SELECT id
          FROM chunks
          WHERE serial_id = ?
        )
      `,
      [input.serialId, input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM chunk_sentences
        WHERE serial_id = ?
      `,
      [input.serialId],
    );
    await input.database.run(
      `
        DELETE FROM chunks
        WHERE serial_id = ?
      `,
      [input.serialId],
    );
    await input.metadata.deleteDeletedChunks();
    await input.metadata.deleteDeletedEntitiesAndTriples();
  });
}

async function rollbackCreatedFiles(
  fileStore: DocumentFileStore,
  createdFilePaths: readonly string[],
): Promise<void> {
  for (const path of [...createdFilePaths].reverse()) {
    try {
      await fileStore.deleteFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }
}

async function rollbackOwnedSerials(
  serialIds: readonly number[],
  deleteSerialResources: (serialId: number) => Promise<void>,
): Promise<void> {
  for (const serialId of [...serialIds].sort(compareNumberDescending)) {
    await deleteSerialResources(serialId);
  }
}
