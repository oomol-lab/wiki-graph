import {
  parseChapterPath,
  parseChapterUriPath,
  parseLocatedWikiGraphUri,
} from "wiki-graph-core";

import { withHelpRoute } from "../../../support/index.js";
import { isWikiGraphUri } from "../uri.js";

export function parseSerialId(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const normalized = value.trim();

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Expected a non-negative integer.`,
        helpRoute,
      ),
    );
  }

  return Number(normalized);
}

export function parseChapterRef(
  value: string,
  flag: string,
  archivePath: string,
  helpRoute: string,
): number {
  const normalized = value.trim();

  if (!isWikiGraphUri(normalized)) {
    return parseSerialId(value, flag, helpRoute);
  }

  const parsed = parseLocatedWikiGraphUri(normalized);

  if (parsed.archivePath !== undefined && parsed.archivePath !== archivePath) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Chapter URI belongs to a different archive.`,
        helpRoute,
      ),
    );
  }

  const objectUri = parsed.objectUri ?? normalized;
  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)\/?$/u.exec(objectUri);

  if (match?.[1] === undefined) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Expected a chapter URI such as wikg://chapter/part/intro.`,
        helpRoute,
      ),
    );
  }

  return Number(match[1]);
}

export function parseChapterPathRef(
  value: string,
  flag: string,
  archivePath: string,
  helpRoute: string,
): string {
  const normalized = value.trim();
  try {
    if (!isWikiGraphUri(normalized)) {
      return parseChapterPath(normalized, flag);
    }

    const parsed = parseLocatedWikiGraphUri(normalized);
    if (
      parsed.archivePath !== undefined &&
      parsed.archivePath !== archivePath
    ) {
      throw new Error(
        `Invalid ${flag}: ${value}. Chapter URI belongs to a different archive.`,
      );
    }

    const path = parseChapterUriPath(parsed.objectUri ?? normalized);
    if (path === undefined) {
      throw new Error(
        `Invalid ${flag}: ${value}. Expected a chapter path or URI.`,
      );
    }
    return path;
  } catch (error) {
    throw new Error(
      withHelpRoute(
        error instanceof Error ? error.message : String(error),
        helpRoute,
      ),
    );
  }
}
