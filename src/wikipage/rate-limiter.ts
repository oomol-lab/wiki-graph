export interface RateLimiterOptions {
  readonly concurrency: number;
  readonly minRequestIntervalMs: number;
}

export class RateLimiter {
  readonly #concurrency: number;
  readonly #minRequestIntervalMs: number;
  #active = 0;
  #blockedUntil = 0;
  #lastStartedAt = 0;
  readonly #queue: Array<() => void> = [];

  public constructor(options: RateLimiterOptions) {
    this.#concurrency = Math.max(1, Math.floor(options.concurrency));
    this.#minRequestIntervalMs = Math.max(
      0,
      Math.floor(options.minRequestIntervalMs),
    );
  }

  public async use<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire();

    try {
      return await operation();
    } finally {
      this.#active -= 1;
      this.#releaseNext();
    }
  }

  public blockFor(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      return;
    }

    this.#blockedUntil = Math.max(this.#blockedUntil, Date.now() + ms);
  }

  async #acquire(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#queue.push(resolve);
      this.#releaseNext();
    });

    await this.#waitForTurn();
    this.#active += 1;
    this.#lastStartedAt = Date.now();
  }

  async #waitForTurn(): Promise<void> {
    const blockedDelayMs = Math.max(0, this.#blockedUntil - Date.now());
    const intervalDelayMs = Math.max(
      0,
      this.#lastStartedAt + this.#minRequestIntervalMs - Date.now(),
    );
    const delayMs = Math.max(blockedDelayMs, intervalDelayMs);

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  #releaseNext(): void {
    if (this.#active >= this.#concurrency) {
      return;
    }

    const resolve = this.#queue.shift();

    if (resolve === undefined) {
      return;
    }

    resolve();
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const retryAt = Date.parse(value);

  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, retryAt - Date.now());
}
