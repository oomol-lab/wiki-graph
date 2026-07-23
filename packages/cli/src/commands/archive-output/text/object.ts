import {
  formatWikiGraphCommandUri,
  parseLocatedWikiGraphUri,
} from "wiki-graph-core";

import { formatCliCommand } from "../../../support/index.js";
import type {
  ArchiveOutputBacklinks,
  ArchiveOutputContext,
  ArchiveOutputObject,
} from "../object/types.js";
import { getTextStreamOutputType } from "../object/uri.js";
import { formatEvidencePreviewContinuation } from "./evidence.js";
import { formatScoredLines } from "./lines.js";
import { formatPlainObject, formatStateInline } from "./plain.js";
import { formatSourceObject } from "./source.js";

export function formatFindObject(object: ArchiveOutputObject): string {
  const lines = formatScoredLines(
    object.score,
    formatObjectSummaryLines(object),
  );

  if (object.evidence !== undefined && object.evidence.sources.length > 0) {
    lines.push(
      "",
      ...object.evidence.sources.flatMap((source, index) => [
        ...(index === 0 ? [] : [""]),
        `-- evidence ${index + 1}/${object.evidence?.shown ?? object.evidence?.sources.length}`,
        formatSourceObject(source),
      ]),
    );

    const hiddenEvidenceCount = object.evidence.total - object.evidence.shown;

    lines.push(
      ...formatEvidencePreviewContinuation(
        object.evidence,
        hiddenEvidenceCount,
      ),
    );
  }

  if (object.backlinks !== undefined) {
    lines.push("", ...formatBacklinkLines(object.backlinks));
  }

  return lines.join("\n");
}

export function formatOpenShortUriHint(
  objects: readonly ArchiveOutputObject[],
  context: ArchiveOutputContext,
): string {
  const shortUri = objects.find((object) => isShortOutputUri(object.uri))?.uri;

  if (shortUri === undefined) {
    return "";
  }

  return `\n\nOpen short URIs with the archive locator, for example:\n  ${formatCliCommand([formatWikiGraphCommandUri(context.archivePath, shortUri)])}`;
}

function isShortOutputUri(uri: string): boolean {
  return (
    uri.startsWith("wikg://") &&
    parseLocatedWikiGraphUri(uri).archivePath === undefined
  );
}

function formatBacklinkLines(backlinks: ArchiveOutputBacklinks): string[] {
  const lines = [
    ...backlinks.chunks.objects,
    ...backlinks.entities.objects,
    ...backlinks.triples.objects,
  ].flatMap((object, index) => [
    ...(index === 0 ? [] : [""]),
    formatFindObject(object),
  ]);

  return lines.length === 0 ? [] : ["Backlinks:", "", ...lines];
}

function formatObjectSummaryLines(object: ArchiveOutputObject): string[] {
  const sourceLines = formatLibrarySourceLines(object);

  if (
    getTextStreamOutputType(object.uri) !== undefined &&
    object.text !== undefined
  ) {
    return [
      ...formatSourceObject({
        text: object.text,
        uri: object.uri,
      }).split("\n"),
      ...sourceLines,
    ];
  }

  if (object.predicate !== undefined) {
    return [object.uri, formatTripleObjectLabel(object), ...sourceLines];
  }

  if (isChapterStateListObject(object)) {
    return [
      [object.uri, object.title, formatStateInline(object.state)]
        .filter((part): part is string => part !== undefined && part !== "")
        .join("  "),
      ...sourceLines,
    ];
  }

  return [
    object.uri,
    object.title,
    object.label,
    object.state === undefined ? undefined : formatStateInline(object.state),
    object.evidence === undefined ? object.text : undefined,
    ...sourceLines,
  ].filter((line): line is string => line !== undefined && line !== "");
}

function formatLibrarySourceLines(object: ArchiveOutputObject): string[] {
  const sources =
    object.sources ??
    (object.archiveId === undefined && object.libraryArchiveUri === undefined
      ? []
      : [
          {
            archiveId: object.archiveId,
            libraryArchiveUri: object.libraryArchiveUri,
          },
        ]);

  return sources.map((source) =>
    [
      source.archiveId === undefined
        ? undefined
        : `archiveId:${source.archiveId}`,
      source.libraryArchiveUri,
    ]
      .filter((part): part is string => part !== undefined)
      .join("  "),
  );
}

export function getListObjectSeparator(
  objects: readonly ArchiveOutputObject[],
): string {
  return objects.every(isChapterStateListObject) ? "\n" : "\n\n";
}

function isChapterStateListObject(
  object: ArchiveOutputObject,
): object is ArchiveOutputObject & {
  readonly state: Record<string, string>;
} {
  return (
    object.state !== undefined &&
    object.uri.startsWith("wikg://chapter/") &&
    !object.uri.includes("/state")
  );
}

function formatTripleObjectLabel(object: ArchiveOutputObject): string {
  const triple = parseTripleOutputUri(object.uri);

  if (triple === undefined) {
    return `${object.subjectLabel ?? "[subject]"} ${object.predicate ?? "[predicate]"} ${object.objectLabel ?? "[object]"}`;
  }

  return `${object.subjectLabel ?? triple.subjectQid}(${triple.subjectQid}) ${object.predicate ?? triple.predicate} ${object.objectLabel ?? triple.objectQid}(${triple.objectQid})`;
}

function parseTripleOutputUri(uri: string):
  | {
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
    }
  | undefined {
  const match =
    /^wikg:\/\/triple\/(Q[1-9][0-9]*)\/([^/]+)\/(Q[1-9][0-9]*)\/?$/u.exec(uri);

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  return {
    objectQid: match[3],
    predicate: decodeURIComponent(match[2]),
    subjectQid: match[1],
  };
}

export function formatChapterObjectText(object: ArchiveOutputObject): string {
  if (isChapterStateListObject(object)) {
    return formatObjectSummaryLines(object).join("\n");
  }

  return formatPlainObject(object);
}
