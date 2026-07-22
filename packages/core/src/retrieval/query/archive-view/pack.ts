import type { ReadonlyDocument } from "../../../document/index.js";

import { readArchivePage } from "./pages.js";
import { listRelatedArchiveObjects } from "./related/index.js";
import { parseWikiGraphReference } from "./references.js";
import type { ArchivePack } from "./types.js";

export async function packArchiveContext(
  document: ReadonlyDocument,
  id: string,
  budget: number,
): Promise<ArchivePack> {
  validatePackReference(id);

  const [anchor, related] = await Promise.all([
    readArchivePage(document, id, { evidenceLimit: 3 }),
    listRelatedArchiveObjects(document, id, { evidenceLimit: 3 }),
  ]);

  return {
    anchor,
    budget,
    related: related.items,
  };
}

function validatePackReference(id: string): void {
  let reference: ReturnType<typeof parseWikiGraphReference>;
  try {
    reference = parseWikiGraphReference(id);
  } catch (error) {
    if (
      /^wikg:\/\/chapter\/.+\/(?:source|summary|title|state)(?:[#/]|$)/u.test(
        id,
      )
    ) {
      throw new Error(
        `Pack is only available for chunk and entity objects: ${id}`,
      );
    }
    throw error;
  }

  switch (reference.type) {
    case "chunk":
    case "entity":
      return;
    case "chapter":
    case "chapter-title":
    case "chapter-state":
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "text-stream":
      throw new Error(
        `Pack is only available for chunk and entity objects: ${id}`,
      );
  }
}
