import { type ArchiveEvidenceItem } from "wiki-graph-core";
import { CLI_PRIMARY_COMMAND } from "wiki-graph-core";

import type { ArchiveOutputEvidencePreview } from "../types.js";
import { formatScoredLines } from "./lines.js";
import { formatSourceCitationBlock, formatSourceObject } from "./source.js";

export function formatEvidenceNextCursor(nextCursor: string | null): string {
  return nextCursor === null
    ? ""
    : `\n\nNext page: ${CLI_PRIMARY_COMMAND} next ${nextCursor}`;
}

export function formatEvidenceItem(item: ArchiveEvidenceItem): string {
  return formatScoredLines(
    item.score,
    formatSourceCitationBlock(item.id, item.source).split("\n"),
  ).join("\n");
}

export function formatEvidencePreviewBlocks(
  evidence: ArchiveOutputEvidencePreview,
): string[] {
  if (evidence.sources.length === 0) {
    return ["[none]"];
  }

  const lines = evidence.sources.flatMap((item, index) => [
    ...(index === 0 ? [] : [""]),
    `-- evidence ${index + 1}/${evidence.shown}`,
    formatSourceObject(item),
  ]);
  const hiddenEvidenceCount = evidence.total - evidence.shown;

  lines.push(
    ...formatEvidencePreviewContinuation(evidence, hiddenEvidenceCount),
  );
  return lines;
}

export function formatEvidencePreviewContinuation(
  evidence: ArchiveOutputEvidencePreview,
  hiddenEvidenceCount: number,
): string[] {
  if (evidence.nextCursor !== null) {
    return [
      "",
      `${hiddenEvidenceCount} more evidence: ${CLI_PRIMARY_COMMAND} next ${evidence.nextCursor}`,
    ];
  }

  return hiddenEvidenceCount > 0
    ? ["", `${hiddenEvidenceCount} evidence more...`]
    : [];
}
