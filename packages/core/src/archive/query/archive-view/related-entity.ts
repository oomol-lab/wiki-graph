import type { ReadonlyDocument } from "../../../document/index.js";

import { compareNumbers } from "./helpers.js";
import { filterMentionsByChapter, formatEntityUri, formatTripleUri } from "./knowledge.js";
import type { WikiGraphReference } from "./references.js";
import type {
  ArchiveListItem,
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
} from "./types.js";
import { hydrateRelatedItemsEvidence } from "./related-pagination.js";
import { filterAndSortEntityRelatedTriplesByQuery } from "./related-query.js";
import { sortRelatedItemsByListMode } from "./related-sort.js";

export async function listRelatedEntityObjects(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "entity" }>,
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const mentions = filterMentionsByChapter(
    await document.mentions.listByQid(reference.qid),
    reference.chapterId,
  );

  if (mentions.length === 0) {
    throw new Error(
      `Entity ${formatEntityUri(reference.qid)} was not found in this archive.`,
    );
  }

  const chapters = [
    ...new Set(mentions.map((mention) => mention.chapterId)),
  ].sort(compareNumbers);
  const role = options.role ?? "any";
  const triplesById = new Map<
    string,
    Extract<ArchiveListItem, { readonly type: "triple" }>
  >();

  for (const chapterId of chapters) {
    for (const link of await document.mentionLinks.listByChapter(chapterId)) {
      const [source, target] = await Promise.all([
        document.mentions.getById(link.sourceMentionId),
        document.mentions.getById(link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }
      if (
        !matchesRelatedEntityRole(source.qid, target.qid, reference.qid, role)
      ) {
        continue;
      }

      const id = formatTripleUri(source.qid, link.predicate, target.qid);

      const existing = triplesById.get(id);

      if (existing !== undefined) {
        triplesById.set(id, {
          ...existing,
          evidenceLinks: [...(existing.evidenceLinks ?? []), link],
        });
        continue;
      }

      triplesById.set(id, {
        evidenceLinks: [link],
        id,
        label: `${source.surface} ${link.predicate} ${target.surface}`,
        objectLabel: target.surface,
        objectQid: target.qid,
        predicate: link.predicate,
        subjectLabel: source.surface,
        subjectQid: source.qid,
        summary: `${source.qid} ${link.predicate} ${target.qid}`,
        type: "triple",
      });
    }
  }

  return await hydrateRelatedItemsEvidence(
    document,
    await filterAndSortEntityRelatedTriplesByQuery(
      document,
      sortRelatedItemsByListMode(
        [...triplesById.values()],
        options.order ?? "doc-asc",
        await document.serials.listDocumentOrders(),
      ),
      reference.qid,
      options.query,
    ),
    options,
  );
}

function matchesRelatedEntityRole(
  subjectQid: string,
  objectQid: string,
  qid: string,
  role: ArchiveRelatedRole,
): boolean {
  const isSubject = subjectQid === qid;
  const isObject = objectQid === qid;
  const isSelf = isSubject && isObject;

  switch (role) {
    case "any":
      return isSubject || isObject;
    case "subject":
      return isSubject && !isSelf;
    case "object":
      return isObject && !isSelf;
    case "self":
      return isSelf;
  }
}
