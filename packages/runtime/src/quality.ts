import { observe, safeErrorGraph, type SafeError } from "./errors.js";
export interface QualityEvent {
  readonly stage: string;
  readonly outcome: "accepted" | "fallback" | "skipped";
  readonly error?: SafeError;
}
export interface QualityPolicy {
  readonly allowFallback?:
    | boolean
    | ((stage: string, error: SafeError) => boolean);
  readonly onOutcome?: (event: QualityEvent) => void;
}
/** Successful empty results count as accepted; failed fallbacks never do. */
export class QualityGate {
  readonly #stages = new Map<
    string,
    { accepted: number; failures: number; firstFailure?: unknown }
  >();
  readonly #policy: QualityPolicy;
  public constructor(policy: QualityPolicy = {}) {
    this.#policy = policy;
  }
  public record(
    stage: string,
    outcome: QualityEvent["outcome"],
    error?: unknown,
  ): void {
    if (!this.#stages.has(stage) && this.#stages.size >= 64)
      throw new Error("Quality stage capacity exceeded");
    const counts = this.#stages.get(stage) ?? { accepted: 0, failures: 0 };
    if (outcome === "accepted") counts.accepted++;
    if (outcome === "fallback") {
      if (counts.failures++ === 0) counts.firstFailure = error;
    }
    this.#stages.set(stage, counts);
    const diagnostic =
      error === undefined ? {} : { error: safeErrorGraph(error) };
    observe(this.#policy.onOutcome, { stage, outcome, ...diagnostic });
    if (outcome === "fallback") {
      const allow = this.#policy.allowFallback;
      if (
        allow === false ||
        (typeof allow === "function" && !allow(stage, safeErrorGraph(error)))
      )
        throw error;
    }
  }
  public assertUsable(): void {
    for (const [stage, counts] of this.#stages) {
      if (counts.failures > 0 && counts.accepted === 0)
        throw new Error(`All ${stage} candidates failed validation`, {
          cause: counts.firstFailure,
        });
    }
  }
}
