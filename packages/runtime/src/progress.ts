export interface ProgressEvent {
  readonly scope: string;
  readonly phase: string;
  readonly unit: string;
  readonly attempt: number;
  readonly done: number;
  readonly total: number;
  readonly outcome: "candidate" | "accepted";
}
/** Each host discards the tracker at its operation boundary. No global cross-account state. */
export class ProgressTracker {
  readonly #values = new Map<string, ProgressEvent>();
  readonly #capacity: number;
  public constructor(capacity = 128) {
    this.#capacity = capacity;
  }
  public update(event: ProgressEvent): ProgressEvent | undefined {
    if (
      ![event.scope, event.phase, event.unit].every(
        (v) => v.length > 0 && v.length <= 256,
      ) ||
      ![event.done, event.total, event.attempt].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ) ||
      event.done > event.total
    )
      throw new RangeError("Invalid progress event");
    const key = JSON.stringify([
      event.scope,
      event.phase,
      event.unit,
      event.attempt,
      event.outcome,
    ]);
    const previous = this.#values.get(key);
    if (!previous && this.#values.size >= this.#capacity)
      throw new Error("Progress scope capacity exceeded");
    const result = {
      ...event,
      done: Math.max(event.done, previous?.done ?? 0),
      total: Math.max(event.total, previous?.total ?? 0),
    };
    if (previous?.done === result.done && previous.total === result.total)
      return undefined;
    this.#values.set(key, result);
    return result;
  }
}
