import type { ChapterStage } from "wiki-graph-core";

import { withHelpRoute } from "../../../support/index.js";

export function parseChapterStage(
  value: string,
  flag: string,
  helpRoute: string,
): ChapterStage {
  const stage = parseExternalChapterStage(value);

  if (stage !== undefined) {
    return stage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid ${flag}: ${value}. Expected planned, source, reading-graph, or reading-summary.`,
      helpRoute,
    ),
  );
}

export function parseResetStage(
  value: string,
  helpRoute: string,
): Exclude<ChapterStage, "summarized"> {
  const stage = parseExternalChapterStage(value);

  if (stage === "planned" || stage === "sourced" || stage === "graphed") {
    return stage;
  }
  if (stage !== undefined) {
    throw new Error(
      withHelpRoute(
        "`chapter reset` does not support --to reading-summary.",
        helpRoute,
      ),
    );
  }

  throw new Error(
    withHelpRoute(
      `Invalid --to: ${value}. Expected planned, source, or reading-graph.`,
      helpRoute,
    ),
  );
}

export function parseExternalChapterStage(
  value: string,
): ChapterStage | undefined {
  switch (value.trim().toLowerCase()) {
    case "planned":
      return "planned";
    case "source":
      return "sourced";
    case "reading-graph":
      return "graphed";
    case "reading-summary":
      return "summarized";
    default:
      return undefined;
  }
}
