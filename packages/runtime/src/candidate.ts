/** Publication is deferred until schema and business validation both accept a candidate. */
export class CandidateAcceptance {
  #state: "pending" | "accepted" | "rejected" = "pending";
  readonly #actions: Array<{
    accept(): Promise<void> | void;
    reject(): Promise<void> | void;
  }> = [];
  public get state(): "pending" | "accepted" | "rejected" {
    return this.#state;
  }
  public defer(
    accept: () => Promise<void> | void,
    reject: () => Promise<void> | void = () => {},
  ): void {
    if (this.#state !== "pending") throw new Error("Candidate already settled");
    this.#actions.push({ accept, reject });
  }
  public async accept(): Promise<void> {
    if (this.#state !== "pending") throw new Error("Candidate already settled");
    try {
      for (const action of this.#actions) await action.accept();
      this.#state = "accepted";
      this.#actions.length = 0;
    } catch (error) {
      try {
        await this.reject();
      } catch {
        /* Preserve the publication error. */
      }
      throw error;
    }
  }
  public async reject(preserveFailure = false): Promise<void> {
    if (this.#state !== "pending") return;
    this.#state = "rejected";
    let failed = false;
    let failure: unknown;
    for (const action of this.#actions) {
      try {
        await action.reject();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    this.#actions.length = 0;
    if (failed && !preserveFailure) throw failure;
  }
}

export interface RequestExecution {
  readonly deadline?: number;
  readonly signal?: AbortSignal;
  readonly candidate?: CandidateAcceptance;
}
