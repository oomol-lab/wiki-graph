import { parseLocatedWikiGraphUri } from "wiki-graph-core";

import {
  isUriHelpPredicate,
  renderUriHelpText,
  renderUriPredicateHelpText,
  type UriHelpTargetName,
} from "../help.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import { parseArchiveArguments } from "../archive.js";
import type {
  ArchiveArgumentValues,
  CLIArchiveUriAction,
  ParsedCLIArguments,
} from "../types.js";
import {
  formatMissingArchiveLocatorMessage,
  formatRemovedImplicitVerbMessage,
  formatWikiGraphHelpCommand,
  isArchiveUriAction,
  isImplicitArchiveReadAction,
  isRemovedImplicitArchiveAction,
  isUriFirstArchiveAction,
  rejectArchiveBooleanFlag,
  stripObjectUriPrefix,
} from "../helpers.js";
import { parseArchiveChapterUriArguments } from "./chapter/routing.js";
import { parseChapterTarget } from "./chapter/target.js";
import {
  parseArchiveUriArchiveArguments,
  parseArchiveCoverUriArguments,
  parseArchiveIndexUriArguments,
} from "./archive-objects.js";
import {
  containsMetadataKeySuffix,
  parseMetadataTarget,
  parseMetadataUriArguments,
} from "./metadata.js";
import { isTripleScopePath } from "./triple-pattern.js";

export function parseArchiveUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const explicitAction = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing URI-first archive URI.");
  }

  const action =
    explicitAction ?? resolveImplicitArchiveUriAction(uri, values.query);

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  if (values.help === true && explicitAction === undefined) {
    const helpTarget = classifyArchiveUriHelpTarget(uri);

    return {
      help: true,
      helpText: renderUriHelpText(helpTarget, uri),
      kind: "help",
    };
  }

  if (values.help === true && explicitAction !== undefined) {
    const helpTarget = classifyArchiveUriHelpTarget(uri);

    if (!isUriHelpPredicate(helpTarget, explicitAction)) {
      throw new Error(
        withHelpRoute(
          `The URI target ${uri} does not support \`${explicitAction}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText(helpTarget, explicitAction, uri),
      kind: "help",
    };
  }

  if (!isArchiveUriAction(action)) {
    const helpCommand = formatWikiGraphHelpCommand(uri);

    throw new Error(
      withHelpRoute(
        `The URI-first form does not support \`${action}\`. Use \`${helpCommand}\` to inspect valid predicates.`,
        helpCommand,
      ),
    );
  }

  return parseArchiveUriTargetArguments(
    uri,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
  );
}

type ArchiveUriKind = "object" | "scope";

function resolveImplicitArchiveUriAction(
  uri: string,
  query: string | undefined,
): CLIArchiveUriAction {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(formatMissingArchiveLocatorMessage(uri));
  }

  const kind = classifyArchiveUri(parsed.objectUri);

  if (kind === "scope") {
    return query === undefined ? "list" : "search";
  }
  if (query !== undefined) {
    throw new Error(
      withHelpRoute(
        "`--query` requires a scope URI, or an explicit `related` or `evidence` command for supported object URIs.",
        CLI_HELP_ROUTES.uri,
      ),
    );
  }

  return "get";
}

function classifyArchiveUri(objectUri: string | undefined): ArchiveUriKind {
  if (objectUri === undefined) {
    return "scope";
  }

  const path = stripObjectUriPrefix(objectUri);

  const chapterTarget = parseChapterTarget(objectUri);
  if (chapterTarget !== undefined) {
    switch (chapterTarget.kind) {
      case "collection":
      case "chapter":
      case "lens":
      case "triple-pattern-lens":
      case "chapter-lens":
      case "chapter-triple-pattern-lens":
        return "scope";
      case "tree":
      case "chapter-resource":
      case "chapter-state":
        return "object";
    }
  }
  if (isTripleScopePath(path)) {
    return "scope";
  }
  if (/^(?:chunk|entity)$/u.test(path)) {
    return "scope";
  }

  return "object";
}

function classifyArchiveUriHelpTarget(uri: string): UriHelpTargetName {
  const parsed = parseLocatedWikiGraphUri(uri);
  const objectUri = parsed.objectUri;

  if (objectUri === undefined) {
    return "archive-scope";
  }

  const path = stripObjectUriPrefix(objectUri);

  if (path === "cover") {
    return "cover-object";
  }
  if (path === "index") {
    return "index-object";
  }
  const chapterTarget = parseChapterTarget(objectUri);
  if (chapterTarget !== undefined) {
    switch (chapterTarget.kind) {
      case "collection":
        return "chapter-collection-scope";
      case "chapter":
        return "chapter-scope";
      case "tree":
        return "chapter-tree-object";
      case "chapter-state":
        return "chapter-state-object";
      case "chapter-resource":
        switch (chapterTarget.resource) {
          case "source":
            return "chapter-source-object";
          case "summary":
            return "chapter-summary-object";
          case "title":
            return "chapter-title-object";
        }
        break;
      case "lens":
      case "chapter-lens":
        switch (chapterTarget.lens) {
          case "chunk":
            return "chunk-scope";
          case "entity":
            return "entity-scope";
          case "source":
            return "chapter-source-object";
          case "summary":
            return "chapter-summary-object";
          case "triple":
            return "triple-scope";
        }
        break;
      case "triple-pattern-lens":
      case "chapter-triple-pattern-lens":
        return "triple-scope";
    }
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?chunk$/u.test(path)) {
    return "chunk-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?chunk\/.+$/u.test(path)) {
    return "chunk-object";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity$/u.test(path)) {
    return "entity-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity\/[^/]+\/wikipage$/u.test(path)) {
    return "entity-wikipage-object";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity\/.+$/u.test(path)) {
    return "entity-object";
  }
  if (isTripleScopePath(path)) {
    return "triple-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?triple(?:\/.*)?$/u.test(path)) {
    return "triple-object";
  }

  throw new Error(
    withHelpRoute(
      `Unknown Wiki Graph URI target: ${uri}. Use the archive root help or URI guide to choose a valid target.`,
      CLI_HELP_ROUTES.uri,
    ),
  );
}

function parseArchiveUriTargetArguments(
  uri: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const parsed = parseLocatedWikiGraphUri(uri);
  const archivePath = parsed.archivePath;
  const objectUri = parsed.objectUri;
  const helpRoute = isImplicitArchiveReadAction(action)
    ? formatWikiGraphHelpCommand(uri)
    : formatWikiGraphHelpCommand(uri, action);

  if (archivePath === undefined) {
    throw new Error(formatMissingArchiveLocatorMessage(uri));
  }
  rejectUnsupportedArchiveReverse(action, values.reverse, helpRoute);

  if (objectUri === undefined) {
    return parseArchiveUriArchiveArguments(
      uri,
      archivePath,
      action,
      tail,
      values,
      helpRoute,
    );
  }

  const metadataTarget = parseMetadataTarget(objectUri);
  if (metadataTarget !== undefined) {
    return parseMetadataUriArguments(
      archivePath,
      metadataTarget,
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (containsMetadataKeySuffix(objectUri)) {
    throw new Error(
      withHelpRoute(
        "Metadata keys are not addressed in the URI. Read `<object>/meta` and filter the output, or use `<object>/meta put <key> ...`.",
        "wg <object-uri>/meta --help",
      ),
    );
  }

  if (objectUri === "wikg://cover") {
    return parseArchiveCoverUriArguments(
      uri,
      archivePath,
      action,
      tail,
      values,
    );
  }

  if (objectUri === "wikg://index") {
    return parseArchiveIndexUriArguments(archivePath, action, tail, values);
  }

  const chapterTarget = parseChapterTarget(objectUri);
  if (chapterTarget !== undefined) {
    return parseArchiveChapterUriArguments(
      uri,
      archivePath,
      chapterTarget,
      action,
      tail,
      values,
    );
  }

  const uriKind = classifyArchiveUri(objectUri);
  if (uriKind === "object" && (action === "list" || action === "search")) {
    throw new Error(
      withHelpRoute(
        `The object URI ${uri} does not support \`${action}\`. Use a scope URI directly, or add --query to a scope URI.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }
  if (uriKind === "scope" && action === "get") {
    throw new Error(
      withHelpRoute(
        `The scope URI ${uri} cannot be read as one object. Use a concrete object URI.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }

  if (!isUriFirstArchiveAction(action)) {
    const helpCommand = formatWikiGraphHelpCommand(uri);

    throw new Error(
      withHelpRoute(
        `The URI target ${uri} does not support \`${action}\`. Use \`${helpCommand}\` to inspect valid predicates.`,
        helpCommand,
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
}

function rejectUnsupportedArchiveReverse(
  action: CLIArchiveUriAction,
  reverse: boolean | undefined,
  helpRoute: string,
): void {
  if (reverse !== true) {
    return;
  }
  if (action === "search") {
    throw new Error(
      withHelpRoute("`--reverse` cannot be combined with --query.", helpRoute),
    );
  }
  if (
    action === "evidence" ||
    action === "get" ||
    action === "list" ||
    action === "related"
  ) {
    return;
  }

  rejectArchiveBooleanFlag(action, "--reverse", reverse, helpRoute);
}
