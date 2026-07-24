import {
  formatLocatedChapterResourceUri,
  formatLocatedChapterSourceCollectionUri,
  formatLocatedChapterUri,
  type ArchiveTriplePattern,
} from "wiki-graph-core";

import { renderArchiveMaintenanceChapterActionHelpText } from "../../help.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../../support/index.js";
import { parseArchiveArguments } from "../../archive.js";
import type {
  ArchiveArgumentValues,
  ArchiveUriLens,
  CLIArchiveChapterAction,
  CLIArchiveUriAction,
  ParsedCLIArguments,
} from "../../types.js";
import {
  formatWikiGraphHelpCommand,
  normalizeArchiveChapterArguments,
  rejectArchiveChapterFlag,
  rejectArchiveChapterMetaFlags,
} from "../../helpers.js";
import type { ChapterUriTarget } from "./target.js";

export function parseArchiveChapterUriArguments(
  uri: string,
  archivePath: string,
  target: ChapterUriTarget,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);

  switch (target.kind) {
    case "collection":
      return parseChapterCollectionUriArguments(
        uri,
        archivePath,
        action,
        tail,
        values,
        helpRoute,
      );
    case "lens":
      return parseArchiveLensUriArguments(
        uri,
        target.lens,
        action,
        tail,
        values,
        helpRoute,
      );
    case "triple-pattern-lens":
      return parseArchiveTriplePatternLensUriArguments(
        uri,
        target.pattern,
        action,
        tail,
        values,
        helpRoute,
      );
    case "tree":
      return parseChapterTreeUriArguments(
        archivePath,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter":
      return parseSingleChapterUriArguments(
        archivePath,
        target.chapterPath,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-lens":
      return parseChapterLensUriArguments(
        archivePath,
        target.chapterPath,
        target.lens,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-triple-pattern-lens":
      return parseChapterTriplePatternLensUriArguments(
        archivePath,
        target.chapterPath,
        target.pattern,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-state":
      return parseChapterStateUriArguments(
        uri,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-resource":
      return parseChapterResourceUriArguments(
        uri,
        archivePath,
        target.chapterPath,
        target.resource,
        action,
        tail,
        values,
        helpRoute,
      );
  }
}

function parseChapterCollectionUriArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "list" || action === "search") {
    return parseArchiveLensUriArguments(
      uri,
      "chapter",
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (!isChapterCollectionMaintenanceAction(action)) {
    throw new Error(
      withHelpRoute(
        `The chapter collection does not support \`${action}\`. Read it directly, add --query, or use add.`,
        "wg <chapter-uri> --help",
      ),
    );
  }

  return parseArchiveChapterLikeArguments(
    action,
    archivePath,
    tail,
    values,
    helpRoute,
  );
}

function isChapterCollectionMaintenanceAction(
  action: CLIArchiveUriAction,
): action is Extract<
  CLIArchiveChapterAction,
  "add" | "move" | "remove" | "reset"
> {
  return (
    action === "add" ||
    action === "move" ||
    action === "remove" ||
    action === "reset"
  );
}

function parseArchiveLensUriArguments(
  uri: string,
  lens: ArchiveUriLens,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The ${lens} collection does not support \`${action}\`. Read it directly, or add --query.`,
        `wg <scope-uri> --help`,
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute, {
    defaultKinds: [lens],
  });
}

function parseArchiveTriplePatternLensUriArguments(
  uri: string,
  pattern: ArchiveTriplePattern,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The triple pattern collection does not support \`${action}\`. Read it directly, or add --query.`,
        "wg <triple-uri> --help",
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute, {
    defaultKinds: ["triple"],
    triplePattern: pattern,
  });
}

function parseChapterTreeUriArguments(
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "get" && action !== "set") {
    throw new Error(
      withHelpRoute(
        `The chapter tree does not support \`${action}\`. Read it directly, or use set.`,
        "wg <archive-uri>/chapter/tree --help",
      ),
    );
  }

  return parseArchiveChapterLikeArguments(
    "tree",
    archivePath,
    tail,
    values,
    helpRoute,
    action === "set" ? "apply" : undefined,
  );
}

function parseSingleChapterUriArguments(
  archivePath: string,
  chapterPath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  switch (action) {
    case "search":
    case "list":
      return parseArchiveArguments(
        action,
        [formatLocatedChapterUri(archivePath, chapterPath), ...tail],
        values,
        helpRoute,
      );
    case "get":
      throw new Error(
        withHelpRoute(
          "`chapter/<path>` is a scope URI. Use `chapter/<path>/title` or `chapter/<path>/state` to read a concrete chapter object.",
          CLI_HELP_ROUTES.uri,
        ),
      );
    case "inspect":
      throw new Error(
        withHelpRoute(
          "`chapter/<path>` inspect is not available. Inspect the archive or read concrete chapter resources instead.",
          CLI_HELP_ROUTES.uri,
        ),
      );
    case "move":
    case "remove":
    case "reset":
      return parseArchiveChapterLikeArguments(
        action,
        archivePath,
        tail,
        { ...values, chapter: chapterPath },
        helpRoute,
      );
    default:
      throw new Error(
        withHelpRoute(
          `The chapter object does not support \`${action}\`.`,
          "wg <chapter-uri> --help",
        ),
      );
  }
}

function parseChapterLensUriArguments(
  archivePath: string,
  chapterPath: string,
  lens: ArchiveUriLens,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The chapter ${lens} collection does not support \`${action}\`. Read it directly, or add --query.`,
        `wg <scope-uri> --help`,
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [formatLocatedChapterUri(archivePath, chapterPath), ...tail],
    values,
    helpRoute,
    { defaultKinds: [lens] },
  );
}

function parseChapterTriplePatternLensUriArguments(
  archivePath: string,
  chapterPath: string,
  pattern: ArchiveTriplePattern,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The chapter triple pattern collection does not support \`${action}\`. Read it directly, or add --query.`,
        "wg <triple-uri> --help",
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [formatLocatedChapterUri(archivePath, chapterPath), ...tail],
    values,
    helpRoute,
    { defaultKinds: ["triple"], triplePattern: pattern },
  );
}

function parseChapterStateUriArguments(
  uri: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "get") {
    throw new Error(
      withHelpRoute(
        `The chapter state object does not support \`${action}\`. Read the state URI directly.`,
        "wg <chapter-uri>/state --help",
      ),
    );
  }

  return parseArchiveArguments("get", [uri, ...tail], values, helpRoute);
}

function parseChapterResourceUriArguments(
  uri: string,
  archivePath: string,
  chapterPath: string,
  resource: "source" | "summary" | "title",
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  const resourceHelpRoute = `wg <chapter-uri>/${resource} --help`;

  if (action === "list" || action === "search") {
    if (resource === "title") {
      throw new Error(
        withHelpRoute(
          `The chapter ${resource} resource does not support \`${action}\`.`,
          resourceHelpRoute,
        ),
      );
    }

    return parseArchiveArguments(
      action,
      [formatLocatedChapterUri(archivePath, chapterPath), ...tail],
      values,
      helpRoute,
      { defaultKinds: [resource] },
    );
  }

  if (action !== "set" && action !== "get" && action !== "clear") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support \`${action}\`. Read it directly, or use set.`,
        resourceHelpRoute,
      ),
    );
  }
  if (action === "clear" && resource !== "title") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support clear.`,
        resourceHelpRoute,
      ),
    );
  }
  if (action === "set" && values.clear === true) {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} set command does not support --clear. Use \`clear\`.`,
        resourceHelpRoute,
      ),
    );
  }

  if (action === "get") {
    const objectUri =
      uri.includes("#") && (resource === "source" || resource === "summary")
        ? uri
        : resource === "source"
          ? formatLocatedChapterSourceCollectionUri(archivePath, chapterPath)
          : formatLocatedChapterResourceUri(archivePath, chapterPath, resource);

    return parseArchiveArguments(
      "get",
      [objectUri, ...tail],
      values,
      helpRoute,
    );
  }

  const mappedAction =
    resource === "source"
      ? "set-source"
      : resource === "summary"
        ? "set-summary"
        : "set-title";

  return parseArchiveChapterLikeArguments(
    mappedAction,
    archivePath,
    tail,
    {
      ...values,
      chapter: chapterPath,
      ...(action === "clear" ? { clear: true } : {}),
    },
    helpRoute,
  );
}

function parseArchiveChapterLikeArguments(
  action: CLIArchiveChapterAction,
  archivePath: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
  treeAction?: "apply",
): ParsedCLIArguments {
  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceChapterActionHelpText(action),
      kind: "chapter",
    };
  }

  rejectArchiveChapterFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectArchiveChapterFlag("depth", values.depth, helpRoute);
  rejectArchiveChapterFlag("jsonl", values.jsonl, helpRoute);
  rejectArchiveChapterFlag("limit", values.limit, helpRoute);
  rejectArchiveChapterFlag("output", values.output, helpRoute);
  rejectArchiveChapterFlag("output-format", values["output-format"], helpRoute);
  rejectArchiveChapterMetaFlags(values, helpRoute);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The chapter command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  const maxPositionals =
    action === "set-source" ||
    action === "set-summary" ||
    action === "set-title"
      ? 1
      : 0;
  if (tail.length > maxPositionals) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${tail.join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: normalizeArchiveChapterArguments(
      action,
      archivePath,
      values,
      helpRoute,
      treeAction,
      tail[0],
    ),
    help: false,
    kind: "chapter",
  };
}
