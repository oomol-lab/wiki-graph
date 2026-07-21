import type { ChunkLink } from "../types.js";
import { createMembershipRecord, hasMembership } from "./helpers.js";

export function filterAndValidateLinks(input: {
  readonly issues: string[];
  readonly links: readonly ChunkLink[];
  readonly tempIds: readonly string[];
  readonly visibleChunkIds: readonly number[];
}): ChunkLink[] {
  const validTempIds = createMembershipRecord(input.tempIds);
  const validChunkIds = createMembershipRecord(input.visibleChunkIds);
  const retainedLinks: ChunkLink[] = [];

  for (const [index, link] of input.links.entries()) {
    const fromValid = validateLinkReference({
      fieldName: "from",
      index: index + 1,
      issues: input.issues,
      reference: link.from,
      validChunkIds,
      validTempIds,
    });
    const toValid = validateLinkReference({
      fieldName: "to",
      index: index + 1,
      issues: input.issues,
      reference: link.to,
      validChunkIds,
      validTempIds,
    });

    if (fromValid && toValid) {
      retainedLinks.push(link);
    }
  }

  return retainedLinks;
}

function validateLinkReference(input: {
  fieldName: "from" | "to";
  index: number;
  issues: string[];
  reference: number | string;
  validChunkIds: Readonly<Record<string, true>>;
  validTempIds: Readonly<Record<string, true>>;
}): boolean {
  if (typeof input.reference === "string") {
    return hasMembership(input.validTempIds, input.reference);
  }

  if (!hasMembership(input.validChunkIds, input.reference)) {
    input.issues.push(
      `Link #${input.index}: "${input.fieldName}" chunk_id ${input.reference} does not exist in visible chunks`,
    );

    return false;
  }

  return true;
}
