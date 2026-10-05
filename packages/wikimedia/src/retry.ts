import type { WikimediaRetryBudget } from "./types.js";

export const DEFAULT_WIKIMEDIA_RETRY_WAIT_BUDGET_MS = 30 * 60 * 1_000;

export function createWikimediaRetryBudget(
  waitBudgetMs = DEFAULT_WIKIMEDIA_RETRY_WAIT_BUDGET_MS,
): WikimediaRetryBudget {
  if (!Number.isFinite(waitBudgetMs) || waitBudgetMs < 0) {
    throw new Error("Wikimedia retry wait budget must be non-negative.");
  }
  let remainingMs = waitBudgetMs;
  return {
    consume(waitMs) {
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > remainingMs) {
        throw new Error("Wikimedia retry wait budget is exhausted.");
      }
      remainingMs -= waitMs;
    },
    get remainingMs() {
      return remainingMs;
    },
  };
}
