import {
  DirectWikimediaResolver,
  HttpWikimediaResolver,
  LlmDisambiguationNormalizer,
  MediaWikiClient,
  UpstreamError,
  type CachedWikimediaQid,
  type WikimediaCache,
  type WikimediaLlmRequest,
  type WikimediaRequestGate,
} from "wiki-graph-wikimedia";

import { Database, openWikiGraphStateDatabase } from "../../document/index.js";
import type { GcContext, GcJobResult } from "../../runtime/gc/index.js";
import type { WikimediaResolver } from "./provider.js";

const CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wikimedia_cache_v1 (
  qid TEXT PRIMARY KEY,
  record_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wikimedia_cache_v1_refreshed_at
ON wikimedia_cache_v1(refreshed_at);
`;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export type WikimediaRuntimeOptions =
  | {
      readonly fetch?: typeof fetch;
      readonly kind: "local";
      readonly llmRequest?: WikimediaLlmRequest;
      readonly requestConcurrency?: number;
      readonly requestIntervalMs?: number;
    }
  | {
      readonly endpoint: string;
      readonly fetch?: typeof fetch;
      readonly kind: "remote";
      readonly token: string;
    };

export interface OpenWikimediaResolver extends WikimediaResolver {
  readonly close: () => Promise<void>;
  readonly mode: "local" | "remote";
}

export async function openWikimediaResolver(
  options: WikimediaRuntimeOptions,
): Promise<OpenWikimediaResolver> {
  if (options.kind === "remote") {
    const resolver = new HttpWikimediaResolver(
      options.endpoint,
      options.token,
      options.fetch,
    );
    return {
      close: async () => undefined,
      mode: "remote",
      resolve: (input, resolveOptions) =>
        resolver.resolve(input, resolveOptions),
    };
  }

  const cache = await SqliteWikimediaCache.open();
  const gate = new LocalWikimediaRequestGate({
    concurrency: options.requestConcurrency ?? 3,
    intervalMs: options.requestIntervalMs ?? 100,
  });
  const client = new MediaWikiClient(options.fetch, undefined, gate);
  const normalizer = new LlmDisambiguationNormalizer(
    options.llmRequest ?? missingLlmRequest,
  );
  const resolver = new DirectWikimediaResolver({
    cache,
    client,
    normalizer,
  });
  return {
    close: async () => await cache.close(),
    mode: "local",
    resolve: (input, resolveOptions) => resolver.resolve(input, resolveOptions),
  };
}

export class SqliteWikimediaCache implements WikimediaCache {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public static async open(): Promise<SqliteWikimediaCache> {
    return new SqliteWikimediaCache(
      await openWikiGraphStateDatabase("cache/cache.sqlite", CACHE_SCHEMA_SQL),
    );
  }

  public async get(
    qids: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadonlyMap<string, CachedWikimediaQid>> {
    const records = new Map<string, CachedWikimediaQid>();
    for (const qid of qids) {
      options?.signal?.throwIfAborted();
      const value = await this.#database.queryOne(
        "SELECT record_json FROM wikimedia_cache_v1 WHERE qid = ?",
        [qid],
        (row) => String(row.record_json),
      );
      const record = value === undefined ? undefined : parseRecord(value);
      if (record !== undefined && record.qid === qid) records.set(qid, record);
    }
    return records;
  }

  public async put(
    records: readonly CachedWikimediaQid[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    await this.#database.transaction(async () => {
      for (const record of records) {
        options?.signal?.throwIfAborted();
        await this.#database.run(
          `INSERT INTO wikimedia_cache_v1(qid,record_json,refreshed_at)
           VALUES(?,?,?)
           ON CONFLICT(qid) DO UPDATE SET
             record_json=excluded.record_json,
             refreshed_at=excluded.refreshed_at`,
          [record.qid, JSON.stringify(record), record.refreshedAt],
        );
      }
    });
  }

  public async close(): Promise<void> {
    await this.#database.close();
  }

  public async gc(context: GcContext): Promise<GcJobResult> {
    const cutoff = new Date(context.now - CACHE_TTL_MS).toISOString();
    const scanned =
      (await this.#database.queryOne(
        "SELECT COUNT(*) AS count FROM wikimedia_cache_v1",
        undefined,
        (row) => Number(row.count),
      )) ?? 0;
    const removed =
      (await this.#database.queryOne(
        "SELECT COUNT(*) AS count FROM wikimedia_cache_v1 WHERE refreshed_at < ?",
        [cutoff],
        (row) => Number(row.count),
      )) ?? 0;
    if (!context.dryRun && removed > 0) {
      await this.#database.run(
        "DELETE FROM wikimedia_cache_v1 WHERE refreshed_at < ?",
        [cutoff],
      );
      await this.#database.run("VACUUM");
    }
    return { freedBytes: 0, removed, scanned };
  }
}

export class LocalWikimediaRequestGate implements WikimediaRequestGate {
  readonly #concurrency: number;
  readonly #intervalMs: number;
  #active = 0;
  #blockedUntil = 0;
  #lastStartedAt = 0;
  readonly #queue: Array<{
    readonly signal?: AbortSignal;
    readonly start: () => void;
  }> = [];
  #startSerial = Promise.resolve();

  public constructor(options: {
    readonly concurrency: number;
    readonly intervalMs: number;
  }) {
    this.#concurrency = Math.max(1, Math.floor(options.concurrency));
    this.#intervalMs = Math.max(0, Math.floor(options.intervalMs));
  }

  public async use<T>(
    operation: () => Promise<T>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<T> {
    await this.#acquire(options?.signal);
    try {
      return await operation();
    } catch (error) {
      if (error instanceof UpstreamError && error.retryAfterMs !== undefined) {
        this.#blockedUntil = Math.max(
          this.#blockedUntil,
          Date.now() + error.retryAfterMs,
        );
      }
      throw error;
    } finally {
      this.#active -= 1;
      this.#drain();
    }
  }

  async #acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const entry = {
        ...(signal === undefined ? {} : { signal }),
        start: () => {
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted === true) {
            reject(signal.reason);
            return;
          }
          this.#active += 1;
          resolve();
        },
      };
      const abort = (): void => {
        const index = this.#queue.indexOf(entry);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(signal?.reason ?? new Error("Wikimedia request aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#queue.push(entry);
      this.#drain();
    });
    const turn = this.#startSerial.then(async () => {
      const delayMs = Math.max(
        0,
        this.#blockedUntil - Date.now(),
        this.#lastStartedAt + this.#intervalMs - Date.now(),
      );
      if (delayMs > 0) await delay(delayMs, signal);
      signal?.throwIfAborted();
      this.#lastStartedAt = Date.now();
    });
    this.#startSerial = turn.catch(() => undefined);
    try {
      await turn;
    } catch (error) {
      this.#active -= 1;
      this.#drain();
      throw error;
    }
  }

  #drain(): void {
    while (this.#active < this.#concurrency) {
      const next = this.#queue.shift();
      if (next === undefined) return;
      if (next.signal?.aborted === true) continue;
      next.start();
    }
  }
}

export async function runWikimediaCacheGc(
  context: GcContext,
): Promise<GcJobResult> {
  const cache = await SqliteWikimediaCache.open();
  try {
    return await cache.gc(context);
  } finally {
    await cache.close();
  }
}

function parseRecord(value: string): CachedWikimediaQid | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Partial<CachedWikimediaQid>;
    if (
      typeof record.qid !== "string" ||
      typeof record.refreshedAt !== "string" ||
      typeof record.disambiguation !== "boolean" ||
      !Array.isArray(record.sites)
    ) {
      return undefined;
    }
    return {
      disambiguation: record.disambiguation,
      qid: record.qid,
      refreshedAt: record.refreshedAt,
      sites: record.sites,
    };
  } catch {
    return undefined;
  }
}

async function missingLlmRequest(): Promise<never> {
  throw new Error(
    "A local LLM provider is required to normalize disambiguation pages",
  );
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const abort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Wikimedia request aborted"));
    };
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
