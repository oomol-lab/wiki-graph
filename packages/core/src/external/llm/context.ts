import { getLogger } from "../../runtime/common/logging.js";
import type { LLMCache, PendingCacheEntry } from "./cache.js";
import type { LLMessage, LLMRequestOptions } from "./types.js";

export interface LLMContextRequestInput<S extends string> {
  messages: readonly LLMessage[];
  options: LLMRequestOptions<S>;
  pendingCacheEntries?: Map<string, PendingCacheEntry>;
  logFiles?: string[];
}

type LLMContextRequest<S extends string> = (
  input: LLMContextRequestInput<S>,
) => Promise<string>;

export class LLMContext<S extends string> {
  readonly #cache: LLMCache | undefined;
  readonly #pendingCacheEntries = new Map<string, PendingCacheEntry>();
  readonly #requestFn: LLMContextRequest<S>;
  readonly #logFiles: string[] = [];
  #finalized = false;
  public readonly sessionId: number;

  public constructor(
    sessionId: number,
    requestFn: LLMContextRequest<S>,
    cache?: LLMCache,
  ) {
    this.sessionId = sessionId;
    this.#cache = cache;
    this.#requestFn = requestFn;
  }

  public async request(
    messages: readonly LLMessage[],
    options: LLMRequestOptions<S> = {},
  ): Promise<string> {
    this.#assertActive();

    return await this.#requestFn({
      logFiles: this.#logFiles,
      messages,
      options,
      pendingCacheEntries: this.#pendingCacheEntries,
    });
  }

  public async commit(): Promise<void> {
    if (this.#finalized) {
      return;
    }

    for (const entry of this.#pendingCacheEntries.values()) {
      if (this.#cache !== undefined) {
        await this.#cache.write(entry);
      }
    }

    this.#pendingCacheEntries.clear();
    this.#finalized = true;
  }

  public rollback(): Promise<void> {
    if (!this.#finalized) {
      this.#pendingCacheEntries.clear();
      this.#finalized = true;
    }

    return Promise.resolve();
  }

  public async run<T>(
    operation: (context: LLMContext<S>) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation(this);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      this.#printLogFiles();
      throw error;
    }
  }

  #assertActive(): void {
    if (this.#finalized) {
      throw new Error("LLMContext is already finalized");
    }
  }

  #printLogFiles(): void {
    if (this.#logFiles.length === 0) {
      return;
    }

    const logger = getLogger({
      component: "llm-context",
      sessionId: this.sessionId,
    });

    logger.warn(
      `\n[LLMContext] Failed with ${this.#logFiles.length} log file(s):`,
    );

    for (const [index, logFile] of this.#logFiles.entries()) {
      logger.warn(`  ${index + 1}. ${logFile}`);
    }
  }
}
