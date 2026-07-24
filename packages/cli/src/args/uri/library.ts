import {
  parseWikiGraphLibraryUri,
  type ParsedWikiGraphLibraryUri,
} from "wiki-graph-core";

import { withHelpRoute } from "../../support/index.js";
import {
  renderLibraryPredicateHelpText,
  renderLibraryUriHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
  isUriHelpPredicate,
  type LibraryHelpPredicateName,
  type UriHelpTargetName,
} from "../help.js";
import type {
  ArchiveArgumentValues,
  CLILibraryAction,
  CLIObjectKind,
  ParsedCLIArguments,
} from "../types.js";
import {
  formatWikiGraphHelpCommand,
  rejectArchiveBooleanFlag,
  rejectArchiveFlag,
  stripObjectUriPrefix,
} from "../helpers.js";
import { parseArchiveArguments } from "../archive.js";
import { parseChapterTarget } from "./chapter/target.js";
import { isTripleScopePath } from "./triple-pattern.js";

const LIBRARY_ARCHIVE_ACTIONS = new Set(["get", "move", "remove"]);
const LIBRARY_METADATA_ACTIONS = new Set([
  "clear",
  "delete",
  "get",
  "put",
  "set",
]);
const LIBRARY_SCOPE_ACTIONS = new Set([
  "add",
  "create",
  "get",
  "list",
  "rebind",
  "remove",
  "scan",
]);
const LIBRARY_INDEX_ACTIONS = new Set(["disable", "enable", "get"]);
const LIBRARY_QUERY_ACTIONS = new Set([
  "evidence",
  "get",
  "list",
  "pack",
  "related",
  "search",
]);

export function parseLibraryUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const explicitAction = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing library URI.");
  }

  const target = parseWikiGraphLibraryUri(uri);
  if (target === undefined) {
    throw new Error(`Expected a Wiki Graph library URI: ${uri}`);
  }

  const action =
    explicitAction ??
    (target.kind === "scope" &&
    ((target.objectUri !== undefined && target.objectUri !== "wikg://index") ||
      values.query !== undefined)
      ? resolveImplicitLibraryQueryAction(target.objectUri, values.query)
      : target.kind === "metadata" || target.objectUri === "wikg://index"
        ? "get"
        : target.kind === "archive"
          ? "get"
          : "list");

  if (values.help === true) {
    return parseLibraryHelpArguments(uri, target, action, explicitAction);
  }

  if (target.kind === "archive" && action === "inspect") {
    return parseLibraryArchiveInspectArguments(
      uri,
      explicitAction === undefined ? [] : positionals.slice(2),
      values,
    );
  }

  if (target.kind === "scope" && target.objectUri === "wikg://index") {
    return parseLibraryIndexArguments(
      uri,
      target,
      action,
      explicitAction === undefined ? [] : positionals.slice(2),
      values,
    );
  }

  if (
    target.kind === "scope" &&
    (target.objectUri !== undefined || action === "search")
  ) {
    return parseLibraryQueryArguments(
      uri,
      target,
      action,
      explicitAction === undefined ? [] : positionals.slice(2),
      values,
    );
  }

  if (!isLibraryAction(action)) {
    throw new Error(
      withHelpRoute(
        `The library URI target ${uri} does not support \`${action}\`.`,
        formatWikiGraphHelpCommand(uri),
      ),
    );
  }
  validateLibraryActionForTarget(uri, target, action);

  if (target.kind === "archive") {
    return parseLibraryArchiveArguments(
      uri,
      target,
      action,
      explicitAction === undefined ? [] : positionals.slice(2),
      values,
    );
  }

  if (target.kind === "metadata") {
    return parseLibraryMetadataArguments(
      uri,
      target,
      action,
      explicitAction === undefined ? [] : positionals.slice(2),
      values,
    );
  }

  return parseLibraryScopeArguments(
    uri,
    target,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
  );
}

function parseLibraryHelpArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: string,
  explicitAction: string | undefined,
): ParsedCLIArguments {
  if (target.kind === "archive" && action === "inspect") {
    return {
      help: true,
      helpText: renderUriPredicateHelpText("archive-scope", "inspect", uri),
      kind: "help",
    };
  }

  if (
    target.kind === "scope" &&
    target.objectUri === undefined &&
    action === "search" &&
    explicitAction === undefined
  ) {
    return {
      help: true,
      helpText: renderLibraryUriHelpText(uri, target),
      kind: "help",
    };
  }

  if (target.kind === "scope" && target.objectUri === "wikg://index") {
    if (explicitAction === undefined) {
      return {
        help: true,
        helpText: renderLibraryUriHelpText(uri, target),
        kind: "help",
      };
    }
    if (!LIBRARY_INDEX_ACTIONS.has(action)) {
      throw new Error(
        withHelpRoute(
          `The library index ${uri} does not support \`${action}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderLibraryPredicateHelpText(
        uri,
        target,
        action as LibraryHelpPredicateName,
      ),
      kind: "help",
    };
  }

  if (target.kind === "scope" && target.objectUri !== undefined) {
    const helpTarget = classifyLibraryObjectHelpTarget(target.objectUri);
    if (explicitAction === undefined) {
      return {
        help: true,
        helpText: renderUriHelpText(helpTarget, uri),
        kind: "help",
      };
    }
    if (isReadOnlyLibraryChapterHelpTarget(helpTarget)) {
      throw new Error(
        withHelpRoute(
          `The library-wide chapter target ${uri} is read-only and does not support \`${action}\`. Use a standalone archive URI or a library archive shortcut such as wikg://lib/<archive-id>/chapter/... for chapter maintenance.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    if (!isUriHelpPredicate(helpTarget, action)) {
      throw new Error(
        withHelpRoute(
          `The library URI target ${uri} does not support \`${action}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText(helpTarget, action, uri),
      kind: "help",
    };
  }

  if (!isLibraryAction(action)) {
    throw new Error(
      withHelpRoute(
        `The library URI target ${uri} does not support \`${action}\`.`,
        formatWikiGraphHelpCommand(uri),
      ),
    );
  }
  validateLibraryActionForTarget(uri, target, action);
  return {
    help: true,
    helpText:
      explicitAction === undefined
        ? renderLibraryUriHelpText(uri, target)
        : renderLibraryPredicateHelpText(uri, target, action),
    kind: "help",
  };
}

function classifyLibraryObjectHelpTarget(objectUri: string): UriHelpTargetName {
  const path = stripObjectUriPrefix(objectUri);
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
            return hasObjectUriFragment(objectUri)
              ? "chapter-source-range-object"
              : "chapter-source-object";
          case "summary":
            return hasObjectUriFragment(objectUri)
              ? "chapter-summary-range-object"
              : "chapter-summary-object";
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
  if (path === "chunk") {
    return "chunk-scope";
  }
  if (/^chunk\/.+$/u.test(path)) {
    return "chunk-object";
  }
  if (path === "entity") {
    return "entity-scope";
  }
  if (/^entity\/[^/]+\/wikipage$/u.test(path)) {
    return "entity-wikipage-object";
  }
  if (/^entity\/.+$/u.test(path)) {
    return "entity-object";
  }
  if (isTripleScopePath(path)) {
    return "triple-scope";
  }
  if (/^triple(?:\/.*)?$/u.test(path)) {
    return "triple-object";
  }

  return "archive-scope";
}

function hasObjectUriFragment(objectUri: string): boolean {
  return objectUri.includes("#");
}

function isReadOnlyLibraryChapterHelpTarget(
  targetName: UriHelpTargetName,
): boolean {
  return (
    targetName === "chapter-collection-scope" ||
    targetName === "chapter-scope" ||
    targetName === "chapter-source-object" ||
    targetName === "chapter-summary-object" ||
    targetName === "chapter-title-object" ||
    targetName === "chapter-tree-object"
  );
}

function parseLibraryQueryArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  if (!LIBRARY_QUERY_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library scope ${uri} does not support \`${action}\`.`,
        formatWikiGraphHelpCommand(uri, action),
      ),
    );
  }
  if (target.objectUri === undefined && action !== "search") {
    throw new Error("Internal error: missing library query object URI.");
  }

  const parsed = parseArchiveArguments(
    action as "evidence" | "get" | "list" | "pack" | "related" | "search",
    [
      target.objectUri === undefined
        ? "wikg://__library_index__.wikg"
        : formatTemporaryLocatedLibraryQueryUri(target.objectUri),
      ...tail,
    ],
    values,
    formatWikiGraphHelpCommand(uri, action),
    {
      ...optionalDefaultKinds(getLibraryQueryDefaultKinds(target.objectUri)),
    },
  );

  if (parsed.kind !== "archive") {
    return parsed;
  }

  const temporaryArchivePath = parsed.args.archivePath;
  const replaceTemporaryUri = (
    value: string | undefined,
  ): string | undefined =>
    value === undefined
      ? undefined
      : value === temporaryArchivePath
        ? uri
        : value.replace(temporaryArchivePath, uri);

  return {
    ...parsed,
    args: {
      ...parsed.args,
      archivePath: uri,
      ...optionalObjectId(replaceTemporaryUri(parsed.args.objectId)),
    },
  };
}

function optionalDefaultKinds(
  defaultKinds: readonly CLIObjectKind[] | undefined,
): { readonly defaultKinds?: readonly CLIObjectKind[] } {
  return defaultKinds === undefined ? {} : { defaultKinds };
}

function optionalObjectId(objectId: string | undefined): {
  readonly objectId?: string;
} {
  return objectId === undefined ? {} : { objectId };
}

function formatTemporaryLocatedLibraryQueryUri(objectUri: string): string {
  const path = stripObjectUriPrefix(objectUri);
  return `wikg://__library_index__.wikg/${path}`;
}

function getLibraryQueryDefaultKinds(
  objectUri: string | undefined,
): readonly CLIObjectKind[] | undefined {
  if (objectUri === undefined) {
    return undefined;
  }
  const path = stripObjectUriPrefix(objectUri);
  const [head] = path.split("/");

  switch (head) {
    case "chapter":
      return ["chapter"];
    case "chunk":
      return ["chunk"];
    case "entity":
      return ["entity"];
    case "source":
      return ["source"];
    case "summary":
      return ["summary"];
    case "triple":
      return ["triple"];
    default:
      return undefined;
  }
}

function resolveImplicitLibraryQueryAction(
  objectUri: string | undefined,
  query: string | undefined,
): "get" | "list" | "search" {
  if (objectUri === undefined) {
    return query === undefined ? "list" : "search";
  }
  const path = stripObjectUriPrefix(objectUri);
  if (/^(?:chapter|chunk|entity|source|summary|triple)$/u.test(path)) {
    return query === undefined ? "list" : "search";
  }

  return "get";
}

function parseLibraryIndexArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);
  if (!LIBRARY_INDEX_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library index ${uri} does not support \`${action}\`.`,
        helpRoute,
      ),
    );
  }

  rejectExtraPositionals(action, tail, 0, helpRoute);
  rejectCommonLibraryFlags(action, values, helpRoute);
  rejectArchiveFlag(action, "--path", values.path, helpRoute);
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);
  rejectArchiveFlag(action, "--to", values.to, helpRoute);

  if (action === "enable") {
    if (values.json === true) {
      throw new Error(
        withHelpRoute(
          "The `enable` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.",
          helpRoute,
        ),
      );
    }
    return {
      args: { action: "enable-index", jsonl: values.jsonl, target },
      help: false,
      kind: "library",
    };
  }

  rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  return {
    args: {
      action: action === "disable" ? "disable-index" : "get-index",
      ...(values.json === undefined ? {} : { json: values.json }),
      target,
    },
    help: false,
    kind: "library",
  };
}

function parseLibraryArchiveArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: CLILibraryAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);
  if (!LIBRARY_ARCHIVE_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library archive ${uri} does not support \`${action}\`.`,
        helpRoute,
      ),
    );
  }
  rejectCommonLibraryFlags(action, values, helpRoute, {
    allowConfirm: action === "remove",
  });
  rejectArchiveFlag(action, "--path", values.path, helpRoute);
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);
  rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  rejectExtraPositionals(action, tail, 0, helpRoute);

  if (action === "get") {
    rejectArchiveFlag(action, "--to", values.to, helpRoute);
    rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
    return {
      args: { action, json: values.json, target },
      help: false,
      kind: "library",
    };
  }

  if (action === "remove") {
    if (values.confirm !== true) {
      throw new Error(withHelpRoute("Missing --confirm.", helpRoute));
    }
    rejectArchiveFlag(action, "--to", values.to, helpRoute);
    return {
      args: { action, confirm: true, json: values.json, target },
      help: false,
      kind: "library",
    };
  }

  if (values.to === undefined) {
    throw new Error(
      withHelpRoute("Missing --to <relative-wikg-path>.", helpRoute),
    );
  }
  rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
  return {
    args: { action, json: values.json, target, to: values.to },
    help: false,
    kind: "library",
  };
}

function parseLibraryArchiveInspectArguments(
  uri: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  return parseArchiveArguments(
    "inspect",
    [uri, ...tail],
    values,
    formatWikiGraphHelpCommand(uri, "inspect"),
  );
}

function parseLibraryScopeArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: CLILibraryAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);
  if (!LIBRARY_SCOPE_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library scope ${uri} does not support \`${action}\`.`,
        helpRoute,
      ),
    );
  }
  rejectCommonLibraryFlags(action, values, helpRoute, {
    allowConfirm: action === "remove",
  });
  rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);

  switch (action) {
    case "add":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      rejectArchiveFlag(action, "--path", values.path, helpRoute);
      if (values.input === undefined) {
        throw new Error(withHelpRoute("Missing --input <path>.", helpRoute));
      }
      return {
        args: {
          action,
          inputPath: values.input,
          json: values.json,
          target,
          ...(values.to === undefined ? {} : { to: values.to }),
        },
        help: false,
        kind: "library",
      };
    case "create":
      if (!target.isDefault) {
        throw new Error(
          withHelpRoute("Create libraries from wikg://lib.", helpRoute),
        );
      }
      rejectExtraPositionals(action, tail, 0, helpRoute);
      if (values.path === undefined) {
        throw new Error(withHelpRoute("Missing --path <folder>.", helpRoute));
      }
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      return {
        args: { action, json: values.json, path: values.path, target },
        help: false,
        kind: "library",
      };
    case "remove":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      rejectArchiveFlag(action, "--path", values.path, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      if (
        (target.kind === "archive" || !target.isDefault) &&
        values.confirm !== true
      ) {
        throw new Error(withHelpRoute("Missing --confirm.", helpRoute));
      }
      return {
        args: {
          action,
          ...(values.confirm === undefined ? {} : { confirm: values.confirm }),
          json: values.json,
          target,
        },
        help: false,
        kind: "library",
      };
    case "rebind":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      if (values.path === undefined) {
        throw new Error(
          withHelpRoute("Missing --path <directory>.", helpRoute),
        );
      }
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      return {
        args: { action, json: values.json, path: values.path, target },
        help: false,
        kind: "library",
      };
    case "get":
    case "list":
    case "scan":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      rejectArchiveFlag(action, "--path", values.path, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      return {
        args: { action, json: values.json, target },
        help: false,
        kind: "library",
      };
    case "set":
    case "put":
    case "delete":
    case "disable-index":
    case "enable-index":
    case "get-index":
    case "clear":
    case "move":
      throw new Error(
        "Internal error: metadata action routed to library scope.",
      );
  }
}

function parseLibraryMetadataArguments(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: CLILibraryAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);
  if (!LIBRARY_METADATA_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library metadata object ${uri} does not support \`${action}\`.`,
        helpRoute,
      ),
    );
  }
  rejectCommonLibraryFlags(action, values, helpRoute);
  rejectArchiveFlag(action, "--path", values.path, helpRoute);
  rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);

  switch (action) {
    case "get":
    case "clear":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      return {
        args: { action, json: values.json, target },
        help: false,
        kind: "library",
      };
    case "set":
      rejectExtraPositionals(action, tail, 1, helpRoute);
      return {
        args: {
          action,
          inputPath: values.input,
          inputValue: tail[0],
          json: values.json,
          jsonInputValue: values["json-input"],
          target,
        },
        help: false,
        kind: "library",
      };
    case "put":
      rejectExtraPositionals(action, tail, 2, helpRoute);
      return {
        args: {
          action,
          inputPath: values.input,
          inputValue: tail[1],
          json: values.json,
          jsonInputValue: values["json-input"],
          key: tail[0],
          target,
        },
        help: false,
        kind: "library",
      };
    case "delete":
      rejectExtraPositionals(action, tail, 1, helpRoute);
      return {
        args: { action, json: values.json, key: tail[0], target },
        help: false,
        kind: "library",
      };
    case "create":
    case "list":
    case "remove":
    case "add":
    case "move":
    case "rebind":
    case "disable-index":
    case "enable-index":
    case "get-index":
    case "scan":
      throw new Error(
        "Internal error: scope action routed to library metadata.",
      );
  }
}

function rejectCommonLibraryFlags(
  action: string,
  values: ArchiveArgumentValues,
  helpRoute: string,
  options: { readonly allowConfirm?: boolean } = {},
): void {
  rejectArchiveFlag(action, "--query", values.query, helpRoute);
  rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
  rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
  rejectArchiveFlag(action, "--context", values.context, helpRoute);
  rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
  rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
  rejectArchiveFlag(action, "--output", values.output, helpRoute);
  rejectArchiveFlag(
    action,
    "--output-format",
    values["output-format"],
    helpRoute,
  );
  rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
  rejectArchiveBooleanFlag(action, "--backlinks", values.backlinks, helpRoute);
  rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
  if (options.allowConfirm !== true) {
    rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
  }
}

function rejectExtraPositionals(
  action: string,
  positionals: readonly string[],
  expected: number,
  helpRoute: string,
): void {
  if (positionals.length > expected) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command received too many positional arguments.`,
        helpRoute,
      ),
    );
  }
}

function isLibraryAction(action: string): action is CLILibraryAction {
  return (
    action === "add" ||
    action === "clear" ||
    action === "create" ||
    action === "delete" ||
    action === "disable-index" ||
    action === "enable-index" ||
    action === "get" ||
    action === "get-index" ||
    action === "list" ||
    action === "move" ||
    action === "put" ||
    action === "rebind" ||
    action === "remove" ||
    action === "scan" ||
    action === "set"
  );
}

function validateLibraryActionForTarget(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  action: CLILibraryAction,
): void {
  const helpRoute = formatWikiGraphHelpCommand(uri);
  if (target.kind === "metadata") {
    if (!LIBRARY_METADATA_ACTIONS.has(action)) {
      throw new Error(
        withHelpRoute(
          `The library metadata object ${uri} does not support \`${action}\`.`,
          helpRoute,
        ),
      );
    }
    return;
  }

  if (target.kind === "archive") {
    if (!LIBRARY_ARCHIVE_ACTIONS.has(action)) {
      throw new Error(
        withHelpRoute(
          `The library archive ${uri} does not support \`${action}\`.`,
          helpRoute,
        ),
      );
    }
    return;
  }

  if (!LIBRARY_SCOPE_ACTIONS.has(action)) {
    throw new Error(
      withHelpRoute(
        `The library scope ${uri} does not support \`${action}\`.`,
        helpRoute,
      ),
    );
  }
  if (action === "create" && !target.isDefault) {
    throw new Error(
      withHelpRoute("Create libraries from wikg://lib.", helpRoute),
    );
  }
  if (action === "remove" && target.isDefault) {
    throw new Error(
      withHelpRoute(
        "The default library cannot be removed. Use a non-default library URI such as wikg://lib/<lib-id>.lib for library registry removal.",
        helpRoute,
      ),
    );
  }
}
