import { AsyncLocalStorage } from "async_hooks";
import { resolve } from "path";

import type * as Sqlite3Namespace from "sqlite3";

type Sqlite3Module = typeof Sqlite3Namespace;
type SqliteDatabase = Sqlite3Namespace.Database;
export type SqlBindValue = Buffer | Uint8Array | number | string | null;
type SqlBindParams = readonly SqlBindValue[];
type SqlRowValue = SqlBindValue;

export type SqlRow = Record<string, SqlRowValue>;

const SQLITE_BUSY_TIMEOUT_MS = 15 * 60 * 1000;

type DatabaseOperationScope = symbol;

export class Database {
  readonly #database: SqliteDatabase;
  readonly #operationScope = new AsyncLocalStorage<DatabaseOperationScope>();
  #activeTransactionScope: DatabaseOperationScope | undefined;
  #closed = false;
  #operationChain: Promise<void> = Promise.resolve();
  #transactionDepth = 0;

  public constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  public static async open(
    databasePath: string,
    schemaSql: string,
    options: { readonly readonly?: boolean } = {},
  ): Promise<Database> {
    const resolvedDatabasePath = resolve(databasePath);
    const database = await openSqliteDatabase(resolvedDatabasePath, options);
    const openedDatabase = new Database(database);

    await openedDatabase.#executeSql(
      `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
    );
    if (options.readonly !== true && schemaSql.trim() !== "") {
      await openedDatabase.#executeSql(schemaSql);
    }

    return openedDatabase;
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

  async #closeDatabase(): Promise<void> {
    await new Promise<void>((resolveClose, rejectClose) => {
      this.#database.close((error) => {
        if (error !== null) {
          rejectClose(error);
          return;
        }

        resolveClose();
      });
    });
  }

  async #executeSql(sql: string): Promise<void> {
    await new Promise<void>((resolveExec, rejectExec) => {
      this.#database.exec(sql, (error) => {
        if (error !== null) {
          rejectExec(error);
          return;
        }

        resolveExec();
      });
    });
  }

  async #queryAllRows(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return await new Promise<SqlRow[]>((resolveAll, rejectAll) => {
      this.#database.all<SqlRow>(
        sql,
        normalizeSqlBindParams(params),
        (error, rows) => {
          if (error !== null) {
            rejectAll(error);
            return;
          }

          resolveAll(rows);
        },
      );
    });
  }

  async #queryOneRow(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return await new Promise<SqlRow | undefined>((resolveGet, rejectGet) => {
      this.#database.get<SqlRow>(
        sql,
        normalizeSqlBindParams(params),
        (error, row) => {
          if (error !== null) {
            rejectGet(error);
            return;
          }

          resolveGet(row);
        },
      );
    });
  }

  async #runStatement(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await new Promise<void>((resolveRun, rejectRun) => {
      this.#database.run(sql, normalizeSqlBindParams(params), (error) => {
        if (error !== null) {
          rejectRun(error);
          return;
        }

        resolveRun();
      });
    });
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

async function openSqliteDatabase(
  databasePath: string,
  options: { readonly readonly?: boolean } = {},
): Promise<SqliteDatabase> {
  const sqlite3 = await loadSqlite3();
  const flags =
    (options.readonly === true
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) | sqlite3.OPEN_FULLMUTEX;

  return await new Promise<SqliteDatabase>((resolveOpen, rejectOpen) => {
    const database = new sqlite3.Database(databasePath, flags, (error) => {
      if (error !== null) {
        rejectOpen(error);
        return;
      }

      resolveOpen(database);
    });
  });
}

async function loadSqlite3(): Promise<Sqlite3Module> {
  const module = await import("sqlite3");

  return resolveSqlite3Module(module as unknown);
}

function resolveSqlite3Module(module: unknown): Sqlite3Module {
  if (
    typeof module === "object" &&
    module !== null &&
    "default" in module &&
    typeof module.default === "object" &&
    module.default !== null &&
    "Database" in module.default
  ) {
    return module.default as Sqlite3Module;
  }

  if (typeof module === "object" && module !== null && "Database" in module) {
    return module as Sqlite3Module;
  }

  throw new TypeError("Could not load sqlite3");
}

function normalizeSqlBindParams(
  params: SqlBindParams | undefined,
): SqlBindParams {
  return params ?? [];
}
