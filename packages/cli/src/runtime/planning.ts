export * from "wiki-graph-sdk/planning";

import type { GenerationPerformanceHint } from "wiki-graph-sdk/planning";

export type CLIGenerationPerformanceHint = Omit<
  GenerationPerformanceHint,
  "configKey" | "configValue"
> & { readonly command: string };

export function toCLIGenerationPerformanceHints(
  hints: readonly GenerationPerformanceHint[],
): readonly CLIGenerationPerformanceHint[] {
  return hints.map(({ configKey, configValue, ...hint }) => ({
    ...hint,
    command: `wg wikg://local/config/concurrent put ${configKey} ${configValue}`,
  }));
}
