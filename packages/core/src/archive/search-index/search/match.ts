import {
  createSearchTokenPlan,
  hasSearchTokens,
  normalizeSearchText,
  type SearchTokenPlan,
} from "./tokenizer.js";
import type { ArchiveFindMatch } from "../../query/view.js";

export interface TierQuery {
  readonly matchExpression: string;
}

export function createTierQueries(
  query: string,
  plan: SearchTokenPlan,
  match: ArchiveFindMatch,
): readonly TierQuery[] {
  if (match === "all") {
    return createAllMatchTierQueries(query);
  }

  return [
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
      ]),
    },
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
        { column: "tier2", tokens: plan.tier2.map((token) => token.encoded) },
      ]),
    },
    {
      matchExpression: createMatchExpression([
        { column: "tier1", tokens: plan.tier1.map((token) => token.encoded) },
        { column: "tier2", tokens: plan.tier2.map((token) => token.encoded) },
        { column: "tier3", tokens: plan.tier3.map((token) => token.encoded) },
      ]),
    },
  ];
}

function createAllMatchTierQueries(query: string): readonly TierQuery[] {
  const termPlans = normalizeSearchText(query)
    .split(/\s+/u)
    .map((term) => createSearchTokenPlan(term))
    .filter(hasSearchTokens);

  const createExpression = (
    selectTokens: (plan: SearchTokenPlan) => readonly string[],
  ): string =>
    termPlans
      .map((termPlan) => {
        const tokens = [...new Set(selectTokens(termPlan))];

        return tokens.length === 0 ? "" : `(${tokens.join(" OR ")})`;
      })
      .filter((term) => term !== "")
      .join(" AND ");

  return [
    {
      matchExpression: createExpression((termPlan) =>
        termPlan.tier1.map((token) => `tier1:${escapeFtsToken(token.encoded)}`),
      ),
    },
    {
      matchExpression: createExpression((termPlan) => [
        ...termPlan.tier1.map(
          (token) => `tier1:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier2.map(
          (token) => `tier2:${escapeFtsToken(token.encoded)}`,
        ),
      ]),
    },
    {
      matchExpression: createExpression((termPlan) => [
        ...termPlan.tier1.map(
          (token) => `tier1:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier2.map(
          (token) => `tier2:${escapeFtsToken(token.encoded)}`,
        ),
        ...termPlan.tier3.map(
          (token) => `tier3:${escapeFtsToken(token.encoded)}`,
        ),
      ]),
    },
  ];
}

function createMatchExpression(
  groups: readonly {
    readonly column: string;
    readonly tokens: readonly string[];
  }[],
): string {
  return groups
    .map((group) => ({
      ...group,
      tokens: [...new Set(group.tokens)],
    }))
    .filter((group) => group.tokens.length > 0)
    .map(
      (group) =>
        `${group.column}:(${group.tokens.map(escapeFtsToken).join(" OR ")})`,
    )
    .join(" OR ");
}

function escapeFtsToken(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}
