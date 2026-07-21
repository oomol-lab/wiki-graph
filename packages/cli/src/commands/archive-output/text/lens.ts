import type { ArchiveFindResult } from "wiki-graph-core";
import { CLI_PRIMARY_COMMAND } from "wiki-graph-core";

export function formatNextCursor(nextCursor: string | null): string {
  if (nextCursor === null) {
    return "";
  }

  return `\n\nNext page: ${CLI_PRIMARY_COMMAND} next ${nextCursor}`;
}

export function formatNoMatches(result: ArchiveFindResult): string {
  if (result.match === "all" && result.terms.length > 1) {
    return `No matches. Try a more specific scope URI, for example: ${CLI_PRIMARY_COMMAND} <archive-uri>/chunk --query "${result.query}"${formatFindLensHint(result)}\n`;
  }

  const lines = [
    "No matches.",
    "Try fewer or broader keywords, or use --query on a scope URI such as `<archive-uri>/chapter`, `<archive-uri>/chunk`, `<archive-uri>/entity`, or `<archive-uri>/triple`.",
  ];

  if (result.lensHint !== null) {
    lines.push(`Lens hint: ${result.lensHint.message}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatFindLensHint(result: ArchiveFindResult): string {
  if (result.lensHint === null) {
    return "";
  }

  return `\n\nLens hint: ${result.lensHint.message}`;
}
