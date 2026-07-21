import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import { isNodeError } from "../../utils/node-error.js";

export interface PendingCacheEntry {
  cacheKey: string;
  response: string;
}

export class LLMCache {
  readonly #cacheDirPath: string;

  public constructor(cacheDirPath: string) {
    this.#cacheDirPath = cacheDirPath;
  }

  public createEntry(cacheKey: string, response: string): PendingCacheEntry {
    return {
      cacheKey,
      response,
    };
  }

  public async read(cacheKey: string): Promise<string | undefined> {
    try {
      return await readFile(this.#getFilePath(cacheKey), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  public async write(entry: PendingCacheEntry): Promise<void> {
    await writeFile(this.#getFilePath(entry.cacheKey), entry.response, "utf8");
  }

  #getFilePath(cacheKey: string): string {
    return join(this.#cacheDirPath, `${cacheKey}.txt`);
  }
}
