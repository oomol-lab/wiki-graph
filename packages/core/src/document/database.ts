import {
  getWikiGraphPlatform,
  isHostFileEmpty,
  resolveHostFile,
} from "../runtime/platform/index.js";
import type {
  File,
  HostAsyncContext,
  HostDatabaseConnection,
  HostDatabaseOpenOptions,
} from "../runtime/platform/index.js";
import { isHostError } from "../utils/host-error.js";
interface DatabaseBackend {
  close(): Promise<void>;
  execute(sql: string): Promise<void>;
  queryAll(sql: string, params: SqlBindParams | undefined): Promise<SqlRow[]>;
  queryOne(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined>;
  run(sql: string, params: SqlBindParams | undefined): Promise<void>;
}
export type SqlBindValue = Uint8Array | number | string | null;
type SqlBindParams = readonly SqlBindValue[];
type SqlRowValue = SqlBindValue;

export type SqlRow = Record<string, SqlRowValue>;

const SQLITE_BUSY_TIMEOUT_MS = 15 * 60 * 1000;

type DatabaseOperationScope = symbol;

async function isMissingOrEmptyFile(file: File): Promise<boolean> {
  try {
    return await isHostFileEmpty(file);
  } catch (error) {
    if (isHostError(error) && error.code === "ENOENT") return true;
    throw error;
  }
}

export class Database {
  readonly #database: DatabaseBackend;
  readonly #onWrite: (() => void) | undefined;
  readonly #operationScope: HostAsyncContext<DatabaseOperationScope>;
  #activeTransactionScope: DatabaseOperationScope | undefined;
  #closed = false;
  #operationChain: Promise<void> = Promise.resolve();
  #transactionDepth = 0;

  public constructor(
    database: DatabaseBackend,
    options: { readonly onWrite?: () => void } = {},
  ) {
    this.#database = database;
    this.#onWrite = options.onWrite;
    this.#operationScope =
      getWikiGraphPlatform().asyncContext.create<DatabaseOperationScope>();
  }

  public static async open(
    databaseFileRef: File | string,
    schemaSql: string,
    options: HostDatabaseOpenOptions & { readonly onWrite?: () => void },
  ): Promise<Database> {
    const databaseFile = await resolveHostFile(databaseFileRef);
    const shouldMarkSchemaWritten =
      options.mode === "readwrite" &&
      options.create &&
      schemaSql.trim() !== "" &&
      (await isMissingOrEmptyFile(databaseFile));
    const connection =
      options.mode === "readonly"
        ? await getWikiGraphPlatform().database.open(databaseFile, {
            mode: "readonly",
          })
        : await getWikiGraphPlatform().database.open(databaseFile, {
            create: options.create,
            mode: "readwrite",
          });
    const openedDatabase = new Database(
      new HostDatabaseBackend(connection),
      options,
    );
    try {
      await openedDatabase.#executeSql(
        `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
      );
      if (options.mode === "readwrite" && schemaSql.trim() !== "") {
        await openedDatabase.#executeSql(schemaSql);
        if (shouldMarkSchemaWritten) {
          openedDatabase.#markWritten();
        }
      }
      return openedDatabase;
    } catch (error) {
      await openedDatabase.close().catch(() => undefined);
      throw error;
    }
  }

  public static async initialize(
    databaseFileRef: File | string,
    schemaSql: string,
  ): Promise<void> {
    const database = await Database.open(databaseFileRef, "", {
      create: true,
      mode: "readwrite",
    });

    try {
      if (schemaSql.trim() !== "") {
        await database.#executeSql(schemaSql);
      }
    } finally {
      await database.close();
    }
  }

  public async queryAll<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T[]> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const rows = await this.#queryAllRows(sql, params);

      return rows.map(mapRow);
    });
  }

  public async queryOne<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T | undefined> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const row = await this.#queryOneRow(sql, params);

      return row === undefined ? undefined : mapRow(row);
    });
  }

  public async run(sql: string, params?: SqlBindParams): Promise<void> {
    await this.#runSerialized(async () => {
      this.#assertOpen();
      await this.#runStatement(sql, params);
      this.#markWritten();
    });
  }

  public async execute(sql: string): Promise<void> {
    await this.#runSerialized(async () => {
      this.#assertOpen();
      await this.#executeSql(sql);
      this.#markWritten();
    });
  }

  public async transaction<T>(operation: () => Promise<T> | T): Promise<T> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const isRootTransaction = this.#transactionDepth === 0;
      const transactionScope =
        this.#activeTransactionScope ?? Symbol("database transaction scope");

      if (isRootTransaction) {
        await this.#executeSql("BEGIN IMMEDIATE");
        this.#activeTransactionScope = transactionScope;
      }

      this.#transactionDepth += 1;

      try {
        const result = await this.#operationScope.run(
          transactionScope,
          operation,
        );

        if (isRootTransaction) {
          await this.#executeSql("COMMIT");
        }

        return result;
      } catch (error) {
        if (isRootTransaction) {
          await this.#executeSql("ROLLBACK");
        }

        throw error;
      } finally {
        this.#transactionDepth -= 1;
        if (isRootTransaction) {
          this.#activeTransactionScope = undefined;
        }
      }
    });
  }

  public async flush(): Promise<void> {
    await this.#runSerialized(() => {
      this.#assertOpen();
    });
  }

  public async close(): Promise<void> {
    await this.#runSerialized(async () => {
      if (this.#closed) {
        return;
      }

      await this.#closeDatabase();
      this.#closed = true;
    });
  }

  public async getLastInsertRowId(): Promise<number> {
    const row = await this.queryOne(
      "SELECT last_insert_rowid() AS row_id",
      undefined,
      (value) => getNumber(value, "row_id"),
    );

    if (row === undefined) {
      throw new Error("Could not read last_insert_rowid()");
    }

    return row;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("Database is already closed");
    }
  }

  async #runSerialized<T>(operation: () => Promise<T> | T): Promise<T> {
    const operationScope = this.#operationScope.getStore();

    if (
      operationScope !== undefined &&
      operationScope === this.#activeTransactionScope
    ) {
      return await operation();
    }

    const queuedOperation = this.#operationChain.then(operation);

    this.#operationChain = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return await queuedOperation;
  }

  #markWritten(): void {
    this.#onWrite?.();
  }

  async #closeDatabase(): Promise<void> {
    await this.#database.close();
  }

  async #executeSql(sql: string): Promise<void> {
    await this.#database.execute(sql);
  }

  async #queryAllRows(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return await this.#database.queryAll(sql, params);
  }

  async #queryOneRow(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return await this.#database.queryOne(sql, params);
  }

  async #runStatement(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await this.#database.run(sql, params);
  }
}

export function getNumber(row: SqlRow, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

export function getString(row: SqlRow, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function getOptionalString(
  row: SqlRow,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

class HostDatabaseBackend implements DatabaseBackend {
  readonly #connection: HostDatabaseConnection;

  public constructor(connection: HostDatabaseConnection) {
    this.#connection = connection;
  }

  public async close(): Promise<void> {
    await this.#connection.close();
  }
  public async execute(sql: string): Promise<void> {
    await this.#connection.execute(sql);
  }
  public async queryAll(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return [...(await this.#connection.queryAll(sql, params))] as SqlRow[];
  }
  public async queryOne(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return (await this.#connection.queryOne(sql, params)) as SqlRow | undefined;
  }
  public async run(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await this.#connection.run(sql, params);
  }
}
