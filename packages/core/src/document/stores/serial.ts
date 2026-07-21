import { getNumber, getOptionalString } from "../database.js";
import type { Database, SqlRow } from "../database.js";
import type { SerialRecord } from "../types.js";
import { compareNumber, isSqliteConstraintError } from "./helpers.js";
import type { ReadonlySerialStore } from "./types.js";

export class SerialStore implements ReadonlySerialStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(): Promise<number> {
    return await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT INTO serials DEFAULT VALUES
        `,
      );

      const serialId = await this.#database.getLastInsertRowId();

      await this.#database.run(
        `
          INSERT INTO serial_states (
            serial_id, revision, topology_ready, knowledge_graph_ready
          )
          VALUES (?, ?, ?, ?)
        `,
        [serialId, 0, 0, 0],
      );

      return serialId;
    });
  }

  public async createWithId(serialId: number): Promise<void> {
    try {
      await this.#database.transaction(async () => {
        await this.#database.run(
          `
            INSERT INTO serials (id)
            VALUES (?)
          `,
          [serialId],
        );

        await this.#database.run(
          `
            INSERT INTO serial_states (
            serial_id, revision, topology_ready, knowledge_graph_ready
          )
          VALUES (?, ?, ?, ?)
        `,
          [serialId, 0, 0, 0],
        );
      });
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new Error(`Serial ${serialId} already exists`);
      }

      throw error;
    }
  }

  public async ensure(serialId: number): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT OR IGNORE INTO serials (id)
          VALUES (?)
        `,
        [serialId],
      );

      await this.#database.run(
        `
          INSERT OR IGNORE INTO serial_states (
            serial_id, revision, topology_ready, knowledge_graph_ready
          )
          VALUES (?, ?, ?, ?)
        `,
        [serialId, 0, 0, 0],
      );
    });
  }

  public async getById(serialId: number): Promise<SerialRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          serials.id AS id,
          serials.document_order AS document_order,
          COALESCE(serial_states.revision, 0) AS revision,
          COALESCE(serial_states.topology_ready, 0) AS topology_ready,
          serial_states.topology_parameter_hash AS topology_parameter_hash,
          COALESCE(serial_states.knowledge_graph_ready, 0) AS knowledge_graph_ready,
          serial_states.knowledge_graph_parameter_hash AS knowledge_graph_parameter_hash
        FROM serials
        LEFT JOIN serial_states
          ON serial_states.serial_id = serials.id
        WHERE serials.id = ?
      `,
      [serialId],
      mapSerialRow,
    );
  }

  public async getRevision(serialId: number): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT COALESCE(revision, 0) AS revision
          FROM serial_states
          WHERE serial_id = ?
        `,
        [serialId],
        (row) => getNumber(row, "revision"),
      )) ?? 0
    );
  }

  public async getRevisions(
    serialIds: readonly number[],
  ): Promise<ReadonlyMap<number, number>> {
    const uniqueIds = [...new Set(serialIds)].sort(compareNumber);

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const rows = await this.#database.queryAll(
      `
        SELECT serial_id, COALESCE(revision, 0) AS revision
        FROM serial_states
        WHERE serial_id IN (${uniqueIds.map(() => "?").join(", ")})
        ORDER BY serial_id
      `,
      uniqueIds,
      (row) =>
        [getNumber(row, "serial_id"), getNumber(row, "revision")] as const,
    );

    return new Map(rows);
  }

  public async bumpRevision(serialId: number): Promise<void> {
    await this.ensure(serialId);
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          UPDATE serial_states
          SET revision = revision + 1
          WHERE serial_id = ?
        `,
        [serialId],
      );
      await this.bumpChaptersRevision();
    });
  }

  public async bumpChaptersRevision(): Promise<void> {
    await this.#database.run(
      `
        INSERT INTO archive_revisions (key, value)
        VALUES ('chapters', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `,
    );
  }

  public async getChaptersRevision(): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT value
          FROM archive_revisions
          WHERE key = 'chapters'
        `,
        undefined,
        (row) => getNumber(row, "value"),
      )) ?? 0
    );
  }

  public async getMaxId(): Promise<number> {
    const maxId = await this.#database.queryOne(
      `
          SELECT COALESCE(MAX(id), 0) AS max_id
          FROM serials
        `,
      undefined,
      (row) => getNumber(row, "max_id"),
    );

    return maxId ?? 0;
  }

  public async setTopologyReady(
    serialId: number,
    ready = true,
    parameterHash?: string,
  ): Promise<void> {
    await this.ensure(serialId);

    if (ready) {
      await this.#database.run(
        `
          UPDATE serial_states
          SET
            topology_ready = ?,
            topology_parameter_hash = COALESCE(?, topology_parameter_hash)
          WHERE serial_id = ?
        `,
        [1, parameterHash ?? null, serialId],
      );
      return;
    }

    await this.#database.run(
      `
        UPDATE serial_states
        SET
          topology_ready = ?,
          topology_parameter_hash = NULL
        WHERE serial_id = ?
      `,
      [0, serialId],
    );
  }

  public async setKnowledgeGraphReady(
    serialId: number,
    ready = true,
    parameterHash?: string,
  ): Promise<void> {
    await this.ensure(serialId);

    if (ready) {
      await this.#database.run(
        `
          UPDATE serial_states
          SET
            knowledge_graph_ready = ?,
            knowledge_graph_parameter_hash = COALESCE(?, knowledge_graph_parameter_hash)
          WHERE serial_id = ?
        `,
        [1, parameterHash ?? null, serialId],
      );
      return;
    }

    await this.#database.run(
      `
        UPDATE serial_states
        SET
          knowledge_graph_ready = ?,
          knowledge_graph_parameter_hash = NULL
        WHERE serial_id = ?
      `,
      [0, serialId],
    );
  }

  public async listIds(): Promise<number[]> {
    return await this.#database.queryAll(
      `
        SELECT id
        FROM serials
        ORDER BY id
      `,
      undefined,
      (row) => getNumber(row, "id"),
    );
  }

  public async listDocumentOrders(): Promise<ReadonlyMap<number, number>> {
    const rows = await this.#database.queryAll(
      `
        SELECT id, document_order
        FROM serials
        ORDER BY id
      `,
      undefined,
      (row) =>
        [getNumber(row, "id"), getNumber(row, "document_order")] as const,
    );

    return new Map(rows);
  }

  public async setDocumentOrders(
    entries: readonly {
      readonly documentOrder: number;
      readonly serialId: number;
    }[],
  ): Promise<void> {
    await this.#database.transaction(async () => {
      for (const entry of entries) {
        await this.#database.run(
          `
            INSERT OR IGNORE INTO serials (id)
            VALUES (?)
          `,
          [entry.serialId],
        );
        await this.#database.run(
          `
            INSERT OR IGNORE INTO serial_states (
              serial_id, revision, topology_ready, knowledge_graph_ready
            )
            VALUES (?, ?, ?, ?)
          `,
          [entry.serialId, 0, 0, 0],
        );
        await this.#database.run(
          `
            UPDATE serials
            SET document_order = ?
            WHERE id = ?
          `,
          [entry.documentOrder, entry.serialId],
        );
      }
    });
  }
}

function mapSerialRow(row: SqlRow): SerialRecord {
  const topologyParameterHash = getOptionalString(
    row,
    "topology_parameter_hash",
  );
  const knowledgeGraphParameterHash = getOptionalString(
    row,
    "knowledge_graph_parameter_hash",
  );

  return {
    documentOrder: getNumber(row, "document_order"),
    id: getNumber(row, "id"),
    knowledgeGraphReady: getNumber(row, "knowledge_graph_ready") !== 0,
    ...(knowledgeGraphParameterHash === undefined
      ? {}
      : { knowledgeGraphParameterHash }),
    revision: getNumber(row, "revision"),
    topologyReady: getNumber(row, "topology_ready") !== 0,
    ...(topologyParameterHash === undefined ? {} : { topologyParameterHash }),
  };
}
