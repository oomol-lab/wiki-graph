import type { ReadonlyDocument } from "../../../../document/index.js";

import { DEFAULT_SOURCE_CONTEXT, requireNode } from "../core.js";
import {
  createEvidenceReadContext,
  createMentionLinkEvidencePreview,
  createNodeEvidenceRanges,
  createSourceEvidencePreview,
} from "../source.js";
import { parseArchiveReference } from "../references.js";
import type {
  ArchiveListItem,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
} from "../types.js";

export async function hydrateRelatedItemsEvidence(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const page = paginateRelatedItems(items, options);

  if (options.evidenceLimit === undefined) {
    return {
      ...page,
      items: page.items.map((item) => {
        if (item.type !== "triple") {
          return item;
        }
        const { evidenceLinks: _evidenceLinks, ...publicItem } = item;
        return publicItem;
      }),
    };
  }

  const context = createEvidenceReadContext();
  const evidenceLimit = options.evidenceLimit;

  return {
    ...page,
    items: await Promise.all(
      page.items.map(async (item) => {
        if (item.evidence !== undefined) {
          return item;
        }
        if (item.type === "triple") {
          const evidence = await createMentionLinkEvidencePreview(
            document,
            item.evidenceLinks ?? [],
            evidenceLimit,
            context,
            options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
            options.order ?? "doc-asc",
          );
          const { evidenceLinks: _evidenceLinks, ...publicItem } = item;

          return { ...publicItem, evidence };
        }
        if (item.type === "node") {
          const reference = parseArchiveReference(item.id);

          if (reference.type !== "node") {
            return item;
          }

          const { node } = await requireNode(document, reference.id);
          return {
            ...item,
            evidence: await createSourceEvidencePreview(
              document,
              createNodeEvidenceRanges(node),
              evidenceLimit,
              context,
              options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
              options.order ?? "doc-asc",
            ),
          };
        }
        return item;
      }),
    ),
  };
}

export function paginateRelatedItems(
  items: readonly ArchiveListItem[],
  options: ArchiveRelatedOptions,
): ArchiveRelatedResult {
  const limit = options.limit ?? 20;
  const offset = parseRelatedCursor(options.cursor);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    limit,
    nextCursor: nextOffset >= items.length ? null : String(nextOffset),
  };
}

function parseRelatedCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^(0|[1-9][0-9]*)$/u.test(cursor)) {
    throw new Error(`Invalid related cursor: ${cursor}`);
  }

  return Number(cursor);
}
