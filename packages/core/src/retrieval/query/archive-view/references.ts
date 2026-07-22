import type { ReadingEdgeRecord } from "../../../document/index.js";
import { WIKI_GRAPH_URI_PREFIX } from "../../../runtime/common/wiki-graph/uri.js";

import {
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
} from "./helpers.js";
import type { ArchiveTextStreamKind, ChapterStateTarget } from "./types.js";

export function formatChapterId(chapterId: number): string {
  return `chapter:${chapterId}`;
}

export function formatChapterTitleId(chapterId: number): string {
  return `chapter-title:${chapterId}`;
}

export function formatEdgeId(edge: ReadingEdgeRecord): string {
  return `edge:${edge.fromId}->${edge.toId}`;
}

export function formatNodeId(nodeId: number): string {
  return `node:${nodeId}`;
}

export function formatSummaryId(chapterId: number): string {
  return `summary:${chapterId}`;
}

export function formatFragmentId(serialId: number, fragmentId: number): string {
  return `fragment:${serialId}:${fragmentId}`;
}

export function formatTextStreamRangeUri(
  chapterPath: number | string,
  stream: ArchiveTextStreamKind,
  startSentenceIndex: number,
  endSentenceIndex: number,
): string {
  const startSentenceNumber = startSentenceIndex + 1;
  const endSentenceNumber = endSentenceIndex + 1;
  const hash =
    startSentenceIndex === endSentenceIndex
      ? String(startSentenceNumber)
      : `${startSentenceNumber}..${endSentenceNumber}`;

  return `wikg://chapter/${chapterPath}/${stream}#${hash}`;
}

export type WikiGraphReference =
  | {
      readonly type: "meta";
    }
  | {
      readonly chapterId: number;
      readonly type: "chapter";
    }
  | {
      readonly chapterId: number;
      readonly type: "chapter-title";
    }
  | {
      readonly chapterId: number;
      readonly target?: ChapterStateTarget;
      readonly type: "chapter-state";
    }
  | {
      readonly type: "chapter-tree";
    }
  | {
      readonly chapterId?: number;
      readonly id: number;
      readonly type: "chunk";
    }
  | {
      readonly chapterId: number;
      readonly endSentenceIndex: number;
      readonly stream: ArchiveTextStreamKind;
      readonly startSentenceIndex: number;
      readonly type: "text-stream";
    }
  | {
      readonly chapterId?: number;
      readonly qid: string;
      readonly type: "entity";
    }
  | {
      readonly qid: string;
      readonly type: "entity-wikipage";
    }
  | {
      readonly chapterId?: number;
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
      readonly type: "triple";
    };

export function parseWikiGraphReference(uri: string): WikiGraphReference {
  uri = normalizeWikiGraphObjectUri(uri);

  if (!isWikiGraphObjectUri(uri)) {
    const archiveReference = parseArchiveReference(uri);

    switch (archiveReference.type) {
      case "node":
        return { id: archiveReference.id, type: "chunk" };
      case "chapter":
        return { chapterId: archiveReference.id, type: "chapter" };
      case "chapter-title":
        return { chapterId: archiveReference.id, type: "chapter-title" };
      case "summary":
        return {
          chapterId: archiveReference.id,
          endSentenceIndex: Number.POSITIVE_INFINITY,
          stream: "summary",
          startSentenceIndex: 0,
          type: "text-stream",
        };
      case "fragment":
      case "meta":
        throw new Error(`Evidence is not available for ${uri}.`);
    }
  }

  if (uri === WIKI_GRAPH_URI_PREFIX) {
    return { type: "meta" };
  }

  const [rawPath = "", hash = ""] = uri
    .slice(WIKI_GRAPH_URI_PREFIX.length)
    .split("#", 2);
  const pathParts = rawPath.split("/").filter((part) => part !== "");

  if (pathParts.length === 0) {
    return { type: "meta" };
  }

  if (pathParts[0] === "chapter-tree" && pathParts.length === 1) {
    return { type: "chapter-tree" };
  }

  switch (pathParts[0]) {
    case "chapter":
      if (pathParts.length === 2) {
        return {
          chapterId: parsePositiveInteger(pathParts[1], uri),
          type: "chapter",
        };
      }
      if (pathParts[1] !== undefined) {
        const chapterId = parsePositiveInteger(pathParts[1], uri);

        switch (pathParts[2]) {
          case "state":
            if (pathParts.length === 3) {
              return { chapterId, type: "chapter-state" };
            }
            if (pathParts.length === 4) {
              return {
                chapterId,
                target: parseChapterStateTarget(pathParts[3], uri),
                type: "chapter-state",
              };
            }
            break;
          case "title":
            if (pathParts.length === 3) {
              return { chapterId, type: "chapter-title" };
            }
            break;
          case "chunk":
            if (pathParts.length === 4) {
              return {
                chapterId,
                id: parsePositiveInteger(pathParts[3], uri),
                type: "chunk",
              };
            }
            break;
          case "entity":
            if (pathParts.length === 4) {
              return {
                chapterId,
                qid: parseQid(pathParts[3], uri),
                type: "entity",
              };
            }
            break;
          case "source":
            if (pathParts.length === 3) {
              const [start, end] = parseSentenceRange(hash);

              return {
                chapterId,
                endSentenceIndex: end,
                stream: "source",
                startSentenceIndex: start,
                type: "text-stream",
              };
            }
            break;
          case "summary":
            if (pathParts.length === 3) {
              const [start, end] = parseSentenceRange(hash);

              return {
                chapterId,
                endSentenceIndex: end,
                stream: "summary",
                startSentenceIndex: start,
                type: "text-stream",
              };
            }
            break;
          case "tree":
            if (pathParts.length === 3) {
              return { chapterId, type: "chapter" };
            }
            break;
          case "triple":
            if (pathParts.length === 6) {
              return {
                chapterId,
                objectQid: parseQid(pathParts[5], uri),
                predicate: decodeURIComponent(pathParts[4] ?? ""),
                subjectQid: parseQid(pathParts[3], uri),
                type: "triple",
              };
            }
            break;
        }
      }
      break;
    case "chunk":
      if (pathParts.length === 2) {
        return {
          id: parsePositiveInteger(pathParts[1], uri),
          type: "chunk",
        };
      }
      break;
    case "entity":
      if (pathParts.length === 2) {
        return {
          qid: parseQid(pathParts[1], uri),
          type: "entity",
        };
      }
      if (pathParts.length === 3 && pathParts[2] === "wikipage") {
        return {
          qid: parseQid(pathParts[1], uri),
          type: "entity-wikipage",
        };
      }
      break;
    case "triple":
      if (pathParts.length === 4) {
        return {
          objectQid: parseQid(pathParts[3], uri),
          predicate: decodeURIComponent(pathParts[2] ?? ""),
          subjectQid: parseQid(pathParts[1], uri),
          type: "triple",
        };
      }
      break;
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function parseQid(value: string | undefined, uri: string): string {
  if (value !== undefined && /^Q[1-9][0-9]*$/u.test(value)) {
    return value;
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function parseChapterStateTarget(
  value: string | undefined,
  uri: string,
): ChapterStateTarget {
  if (
    value === "source" ||
    value === "reading-graph" ||
    value === "reading-summary" ||
    value === "knowledge-graph"
  ) {
    return value;
  }

  throw new Error(`Invalid Wiki Graph URI: ${uri}`);
}

function parseSentenceRange(hash: string): readonly [number, number] {
  if (hash === "") {
    return [0, Number.POSITIVE_INFINITY];
  }

  const match = /^([1-9][0-9]*)(?:\.\.([1-9][0-9]*))?$/u.exec(hash);

  if (match?.[1] === undefined) {
    throw new Error(`Invalid source sentence range: ${hash}`);
  }

  const parsedStart = Number(match[1]) - 1;
  const parsedEnd = Number(match[2] ?? match[1]) - 1;

  if (
    Number.isInteger(parsedStart) &&
    parsedStart >= 0 &&
    Number.isInteger(parsedEnd) &&
    parsedEnd >= parsedStart
  ) {
    return [parsedStart, parsedEnd];
  }

  throw new Error(`Invalid source sentence range: ${hash}`);
}

export function parseArchiveReference(id: string):
  | {
      readonly id: number;
      readonly type: "chapter" | "chapter-title" | "summary";
    }
  | {
      readonly id: number;
      readonly type: "node";
    }
  | {
      readonly fragmentId: number;
      readonly serialId: number;
      readonly type: "fragment";
    }
  | {
      readonly type: "meta";
    } {
  const normalized = id.trim();
  const [type, value] = normalized.split(":", 2);

  if (type === "meta" && (value === "book" || value === "root")) {
    return { type: "meta" };
  }
  if (type === "chapter" || type === "chapter-title" || type === "summary") {
    const parsedId = parsePositiveInteger(value, normalized);

    return { id: parsedId, type };
  }
  if (type === "node") {
    const parsedId = parsePositiveInteger(value, normalized);

    return {
      id: parsedId,
      type: "node",
    };
  }
  if (type === "fragment") {
    const parts = normalized.slice("fragment:".length).split(":");

    if (parts.length !== 2) {
      throw new Error(`Invalid archive object id: ${id}`);
    }

    return {
      fragmentId: parseNonNegativeInteger(parts[1], normalized),
      serialId: parsePositiveInteger(parts[0], normalized),
      type: "fragment",
    };
  }
  throw new Error(`Invalid archive object id: ${id}`);
}

function parsePositiveInteger(value: string | undefined, id: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid archive object id: ${id}`);
  }

  return parsed;
}

function parseNonNegativeInteger(
  value: string | undefined,
  id: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid archive object id: ${id}`);
  }

  return parsed;
}
