import type { TokenUsage } from "./openai.js";

export interface UsageSummary {
  readonly version: 1;
  readonly attempts: number;
  readonly acceptedAttempts: number;
  readonly rejectedAttempts: number;
  readonly unclassifiedAttempts: number;
  readonly pendingAttempts: number;
  readonly unknownUsageAttempts: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}
export interface UsageSnapshot {
  readonly sequence: number;
  readonly totals: UsageSummary;
}
export type AttemptDisposition = "accepted" | "rejected" | "unclassified";
export interface AttemptUsage {
  record(usage: TokenUsage): void;
  finish(disposition: AttemptDisposition): void;
}
export function emptyUsage(): UsageSummary {
  return {
    version: 1,
    attempts: 0,
    acceptedAttempts: 0,
    rejectedAttempts: 0,
    unclassifiedAttempts: 0,
    pendingAttempts: 0,
    unknownUsageAttempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
}
export function addUsage(
  left: UsageSummary,
  right: UsageSummary,
): UsageSummary {
  const output = { ...left };
  for (const key of Object.keys(left) as Array<keyof UsageSummary>) {
    if (key !== "version")
      output[key] = Math.min(Number.MAX_SAFE_INTEGER, left[key] + right[key]);
  }
  return output;
}

/** Completed attempts become fixed-size totals; only bounded live candidates retain records. */
export class UsageLedger {
  readonly #active = new Set<{ usage: TokenUsage | undefined }>();
  #totals = emptyUsage();
  #sequence = 0;
  readonly #maxPending: number;
  public constructor(maxPending = 256) {
    this.#maxPending = maxPending;
  }
  public begin(): AttemptUsage {
    if (this.#active.size >= this.#maxPending)
      throw new Error("Too many pending usage candidates");
    const item: { usage: TokenUsage | undefined } = { usage: undefined };
    this.#active.add(item);
    this.#sequence++;
    return {
      record: (usage) => {
        if (!this.#active.has(item)) return;
        const normalized: Record<string, number> = {};
        for (const key of [
          "inputTokens",
          "outputTokens",
          "cacheReadTokens",
        ] as const) {
          const value = usage[key];
          if (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0
          )
            normalized[key] = Math.max(item.usage?.[key] ?? 0, value);
        }
        item.usage = { ...item.usage, ...normalized };
        this.#sequence++;
      },
      finish: (disposition) => {
        if (!this.#active.delete(item)) return;
        this.#totals = addUsage(
          this.#totals,
          summarize(item.usage, disposition),
        );
        this.#sequence++;
      },
    };
  }
  public snapshot(): UsageSnapshot {
    let totals = this.#totals;
    for (const item of this.#active)
      totals = addUsage(totals, summarize(item.usage));
    return { sequence: this.#sequence, totals };
  }
}
function summarize(
  usage: TokenUsage | undefined,
  disposition?: AttemptDisposition,
): UsageSummary {
  return {
    ...emptyUsage(),
    attempts: 1,
    acceptedAttempts: Number(disposition === "accepted"),
    rejectedAttempts: Number(disposition === "rejected"),
    unclassifiedAttempts: Number(disposition === "unclassified"),
    pendingAttempts: Number(disposition === undefined),
    unknownUsageAttempts: Number(
      usage?.inputTokens === undefined || usage.outputTokens === undefined,
    ),
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
  };
}

export function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(snapshot.sequence) ||
    (snapshot.sequence as number) < 0 ||
    !snapshot.totals ||
    typeof snapshot.totals !== "object"
  )
    return false;
  const totals = snapshot.totals as Record<string, unknown>;
  const keys = Object.keys(emptyUsage());
  if (Object.keys(totals).length !== keys.length || totals.version !== 1)
    return false;
  return (
    keys.every(
      (key) =>
        Number.isSafeInteger(totals[key]) && (totals[key] as number) >= 0,
    ) &&
    (totals.acceptedAttempts as number) +
      (totals.rejectedAttempts as number) +
      (totals.unclassifiedAttempts as number) +
      (totals.pendingAttempts as number) ===
      totals.attempts &&
    (totals.unknownUsageAttempts as number) <= totals.attempts
  );
}
