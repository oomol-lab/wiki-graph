import type { ReadonlyDocument } from "../../../../document/index.js";
import type { GraphNeighbor } from "../../../../facade/graph.js";
import { listGraphNeighbors } from "../../../../facade/graph.js";

import {
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
} from "../helpers.js";
import { requireChapter, requireNode } from "../core.js";
import {
  hydrateRelatedItemsEvidence,
  paginateRelatedItems,
} from "./pagination.js";
import { listRelatedEntityObjects } from "./entity.js";
import { filterAndSortChunkRelatedItemsByQuery } from "./query.js";
import { sortGraphNeighborsByListMode } from "./sort.js";
export { resolveEntityWikipage } from "./wikipage.js";
import { formatChapterId, formatNodeId, parseArchiveReference, parseWikiGraphReference } from "../references.js";
import type {
  ArchiveRelatedOptions,
  ArchiveRelatedResult,
  ArchiveRelatedRole,
} from "../types.js";

export async function listArchiveLinks(
  document: ReadonlyDocument,
  id: string,
  direction: "backlinks" | "links",
): Promise<readonly GraphNeighbor[]> {
  return (await listAllArchiveLinks(document, id)).filter((neighbor) =>
    direction === "links"
      ? neighbor.direction === "outgoing"
      : neighbor.direction === "incoming",
  );
}

export async function listAllArchiveLinks(
  document: ReadonlyDocument,
  id: string,
): Promise<readonly GraphNeighbor[]> {
  if (isWikiGraphObjectUri(id)) {
    id = normalizeWikiGraphObjectUri(id);
    const reference = parseWikiGraphReference(id);

    if (reference.type !== "chunk") {
      return [];
    }

    const { chapterId } = await requireNode(document, reference.id);

    if (
      reference.chapterId !== undefined &&
      reference.chapterId !== chapterId
    ) {
      throw new Error(`Chunk ${id} was not found in this archive.`);
    }

    return await listGraphNeighbors(document, chapterId, reference.id);
  }

  const reference = parseArchiveReference(id);

  if (reference.type !== "node") {
    return [];
  }

  const { chapterId } = await requireNode(document, reference.id);
  return await listGraphNeighbors(document, chapterId, reference.id);
}

export async function listRelatedArchiveObjects(
  document: ReadonlyDocument,
  id: string,
  options: ArchiveRelatedOptions = {},
): Promise<ArchiveRelatedResult> {
  if (isWikiGraphObjectUri(id)) {
    return await listRelatedWikiGraphObjects(
      document,
      normalizeWikiGraphObjectUri(id),
      options,
    );
  }

  const reference = parseArchiveReference(id);
  if (reference.type !== "node") {
    rejectRelatedRole(options.role, id);
    return paginateRelatedItems([], options);
  }
  rejectRelatedRole(options.role, id);

  const documentOrders = await document.serials.listDocumentOrders();
  const { chapterId } = await requireNode(document, reference.id);
  const items = sortGraphNeighborsByListMode(
    await listGraphNeighbors(document, chapterId, reference.id),
    documentOrders,
    options.order ?? "doc-asc",
  ).map((neighbor) => ({
    id: formatNodeId(neighbor.node.id),
    label: neighbor.node.label,
    summary: neighbor.node.content,
    type: "node" as const,
  }));

  return await hydrateRelatedItemsEvidence(
    document,
    await filterAndSortChunkRelatedItemsByQuery(document, items, options.query),
    options,
  );
}

async function listRelatedWikiGraphObjects(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveRelatedOptions,
): Promise<ArchiveRelatedResult> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "chapter": {
      throw new Error(`Related is not available for scope URI: ${uri}`);
    }
    case "chapter-title":
      rejectRelatedRole(options.role, uri);
      return paginateRelatedItems([], options);
    case "chunk": {
      rejectRelatedRole(options.role, uri);
      const { chapterId } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }

      const items = sortGraphNeighborsByListMode(
        await listGraphNeighbors(document, chapterId, reference.id),
        await document.serials.listDocumentOrders(),
        options.order ?? "doc-asc",
      ).map((neighbor) => ({
        id: formatNodeId(neighbor.node.id),
        label: neighbor.node.label,
        summary: neighbor.node.content,
        type: "node" as const,
      }));

      return await hydrateRelatedItemsEvidence(
        document,
        await filterAndSortChunkRelatedItemsByQuery(
          document,
          items,
          options.query,
        ),
        options,
      );
    }
    case "text-stream": {
      rejectRelatedQuery(options.query, uri);
      rejectRelatedRole(options.role, uri);
      const chapter = await requireChapter(document, reference.chapterId);

      return await hydrateRelatedItemsEvidence(
        document,
        [
          {
            id: formatChapterId(reference.chapterId),
            label: chapter.title ?? `[chapter ${reference.chapterId}]`,
            summary: `${chapter.stage}; ${chapter.fragmentCount} fragments`,
            type: "chapter",
          },
        ],
        options,
      );
    }
    case "entity":
      return await listRelatedEntityObjects(document, reference, options);
    case "triple":
      throw new Error(
        `Related is only available for chunk and entity objects: ${uri}`,
      );
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "chapter-state":
      rejectRelatedQuery(options.query, uri);
      rejectRelatedRole(options.role, uri);
      return paginateRelatedItems([], options);
  }
}






function rejectRelatedRole(
  role: ArchiveRelatedRole | undefined,
  id: string,
): void {
  if (role !== undefined && role !== "any") {
    throw new Error(`--role is only available for entity related: ${id}`);
  }
}

function rejectRelatedQuery(query: string | undefined, id: string): void {
  if (query !== undefined) {
    throw new Error(
      `Related query is only available for chunk and entity: ${id}`,
    );
  }
}
