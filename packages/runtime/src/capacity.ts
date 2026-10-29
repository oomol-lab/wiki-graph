/** A retained resource keeps its slot until it actually settles, including after cancellation. */
export interface ResourceLease {
  retainUntil(resource: Promise<unknown>): void;
}

export class CapacityPool {
  readonly #concurrency: number;
  readonly #maxQueued: number;
  #active = 0;
  readonly #queue: Array<{ start(): void; cancel(): void }> = [];

  public constructor(concurrency: number, maxQueued = 256) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isInteger(maxQueued) ||
      maxQueued < 0
    )
      throw new RangeError("Invalid capacity limits");
    this.#concurrency = concurrency;
    this.#maxQueued = maxQueued;
  }

  public get active(): number {
    return this.#active;
  }
  public get queued(): number {
    return this.#queue.length;
  }

  public async use<T>(
    operation: (lease: ResourceLease) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.#acquire(signal);
    const retained: Promise<unknown>[] = [];
    try {
      signal?.throwIfAborted();
      return await operation({
        retainUntil: (resource) => {
          retained.push(resource.catch(() => {}));
        },
      });
    } finally {
      if (retained.length === 0) this.#release();
      else void Promise.allSettled(retained).then(() => this.#release());
    }
  }

  async #acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#active < this.#concurrency) {
      this.#active++;
      return;
    }
    if (this.#queue.length >= this.#maxQueued)
      throw new Error("Provider pending capacity exceeded");
    await new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => {
          signal?.removeEventListener("abort", entry.cancel);
          this.#active++;
          resolve();
        },
        cancel: () => {
          const index = this.#queue.indexOf(entry);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          signal?.removeEventListener("abort", entry.cancel);
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(signal?.reason);
        },
      };
      this.#queue.push(entry);
      signal?.addEventListener("abort", entry.cancel, { once: true });
    });
  }

  #release(): void {
    this.#active--;
    this.#queue.shift()?.start();
  }
}
