import type {
  ArchiveBacklinkBucket,
  ArchiveBacklinks,
  ArchiveEvidenceItem,
  ArchiveFindEvidencePreview,
  ArchiveFindHit,
  ArchiveListItem,
  ArchivePack,
  ArchivePage,
} from "wiki-graph-core";

import { createOutputContinuationCursor } from "./cursor.js";
import type {
  ArchiveOutputBacklinks,
  ArchiveOutputContext,
  ArchiveOutputEvidencePreview,
  ArchiveOutputObject,
  ArchiveOutputResultPage,
  ArchiveOutputSource,
} from "./types.js";
import {
  getTextStreamOutputType,
  isTextStreamOutputType,
  toWikiGraphUri,
} from "./uri.js";

export async function createListObject(
  item: ArchiveListItem,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputObject> {
  if (item.type === "triple") {
    return {
      ...(context.evidenceLimit === undefined || item.evidence === undefined
        ? {}
        : {
            evidence: await createEvidencePreviewObject(item.evidence, {
              ...context,
              continuationKind: "evidence",
              targetUri: toWikiGraphUri(item.id),
            }),
          }),
      objectLabel: item.objectLabel,
      predicate: item.predicate,
      ...(item.score === undefined ? {} : { score: item.score }),
      subjectLabel: item.subjectLabel,
      uri: toWikiGraphUri(item.id),
    };
  }

  return {
    ...(context.evidenceLimit === undefined || item.evidence === undefined
      ? {}
      : {
          evidence: await createEvidencePreviewObject(item.evidence, {
            ...context,
            continuationKind: "evidence",
            targetUri: toWikiGraphUri(item.id),
          }),
        }),
    label: item.label,
    ...(item.score === undefined ? {} : { score: item.score }),
    ...(isTextStreamOutputType(item.type)
      ? { text: item.summary }
      : { type: item.type }),
    uri: toWikiGraphUri(item.id),
  };
}

export function createObjectResultPage(
  objects: readonly ArchiveOutputObject[],
  nextCursor: string | null,
  limit: number,
): {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly objects: readonly ArchiveOutputObject[];
} {
  return {
    limit,
    nextCursor,
    objects,
  };
}

export async function createFindObject(
  hit: ArchiveFindHit,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputObject> {
  const uri = toWikiGraphUri(hit.id);

  if (hit.type === "chapter") {
    return {
      ...(hit.state === undefined ? {} : { state: hit.state }),
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "chapter-title") {
    return {
      title: hit.title,
      type: "chapter-title",
      uri,
    };
  }
  if (hit.type === "meta") {
    return {
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "triple") {
    const triple = hit.triple;

    return {
      ...(hit.backlinks === undefined
        ? {}
        : { backlinks: await createBacklinksObject(hit.backlinks, context) }),
      ...(context.evidenceLimit === undefined || hit.evidence === undefined
        ? {}
        : {
            evidence: await createEvidencePreviewObject(hit.evidence, {
              ...context,
              continuationKind: "evidence",
              targetUri: uri,
            }),
          }),
      objectLabel: triple?.objectLabel ?? "",
      predicate: triple?.predicate ?? "",
      subjectLabel: triple?.subjectLabel ?? "",
      uri,
    };
  }

  return {
    ...(hit.backlinks === undefined
      ? {}
      : { backlinks: await createBacklinksObject(hit.backlinks, context) }),
    ...(context.evidenceLimit === undefined || hit.evidence === undefined
      ? {}
      : {
          evidence: await createEvidencePreviewObject(hit.evidence, {
            ...context,
            continuationKind: "evidence",
            targetUri: uri,
          }),
        }),
    label: hit.title,
    ...(isTextStreamOutputType(hit.type)
      ? { text: hit.snippet }
      : { type: hit.type === "node" ? "chunk" : hit.type }),
    uri,
  };
}

export async function createEvidencePreviewObject(
  evidence: ArchiveFindEvidencePreview,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputEvidencePreview> {
  return {
    nextCursor: await createOutputContinuationCursor(
      {
        ...context,
        continuationKind: "evidence",
      },
      evidence.nextCursor,
    ),
    shown: evidence.shown,
    sources: evidence.sources.map(createSourceObject),
    total: evidence.total,
  };
}

export function createSourceObject(
  item: ArchiveEvidenceItem,
): ArchiveOutputSource {
  return {
    ...(item.score === undefined ? {} : { score: item.score }),
    text: item.source,
    uri: item.id,
  };
}

async function createBacklinksObject(
  backlinks: ArchiveBacklinks,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputBacklinks> {
  return {
    chunks: await createBacklinkBucketObject(backlinks.chunks, context),
    entities: await createBacklinkBucketObject(backlinks.entities, context),
    triples: await createBacklinkBucketObject(backlinks.triples, context),
  };
}

async function createBacklinkBucketObject(
  bucket: ArchiveBacklinkBucket,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputResultPage> {
  const objects = await Promise.all(
    bucket.items.map(
      async (item) =>
        await createFindObject(item, {
          ...context,
          backlinks: false,
        }),
    ),
  );

  return createObjectResultPage(objects, bucket.nextCursor, bucket.limit);
}

export async function createPageObject(
  page: ArchivePage,
  context: ArchiveOutputContext,
): Promise<unknown> {
  switch (page.type) {
    case "entity-wikipage":
      return {
        en: page.en,
        uri: page.id,
        zh: page.zh,
      };
    case "entity":
      return {
        labels: page.labels.slice(0, 7),
        qid: page.qid,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "triple":
      return {
        label: page.label,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "chapter": {
      return {
        state: page.state,
        title: page.title,
        uri: toWikiGraphUri(page.id),
      };
    }
    case "chapter-title":
      return {
        title: page.title,
        type: "chapter-title",
        uri: toWikiGraphUri(page.id),
      };
    case "chapter-tree": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "fragment": {
      const {
        backlinks,
        id: _id,
        nextFragmentId,
        previousFragmentId,
        ...rest
      } = page;
      const textStreamType = getTextStreamOutputType(page.id);

      if (textStreamType !== undefined) {
        return {
          ...(backlinks === undefined
            ? {}
            : { backlinks: await createBacklinksObject(backlinks, context) }),
          text: page.fragment.text,
          uri: toWikiGraphUri(page.id),
        };
      }

      return {
        ...rest,
        ...(backlinks === undefined
          ? {}
          : { backlinks: await createBacklinksObject(backlinks, context) }),
        ...(nextFragmentId === undefined
          ? {}
          : { nextUri: toWikiGraphUri(nextFragmentId) }),
        ...(previousFragmentId === undefined
          ? {}
          : { previousUri: toWikiGraphUri(previousFragmentId) }),
        uri: toWikiGraphUri(page.id),
      };
    }
    case "meta": {
      const { id: _id, type: _type, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "state": {
      if ("state" in page) {
        return { ...page.state, uri: toWikiGraphUri(page.id) };
      }

      return { uri: toWikiGraphUri(page.id), value: page.value };
    }
    case "node": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "summary": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
  }
}

export async function createPackObject(
  pack: ArchivePack,
  context: ArchiveOutputContext,
): Promise<{
  readonly anchor: unknown;
  readonly related: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly objects: readonly ArchiveOutputObject[];
  };
}> {
  const relatedObjects = await Promise.all(
    pack.related.map(async (item) => await createListObject(item, context)),
  );

  return {
    anchor: await createPageObject(pack.anchor, context),
    related: createObjectResultPage(
      relatedObjects,
      null,
      relatedObjects.length,
    ),
  };
}
