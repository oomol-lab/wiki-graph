import {
  parseWikiGraphLibraryUri,
  type ParsedWikiGraphLibraryUri,
} from "wiki-graph-core";

import { withHelpRoute } from "../../support/index.js";
import type {
  ArchiveArgumentValues,
  CLILibraryAction,
  ParsedCLIArguments,
} from "../types.js";
import {
  formatWikiGraphHelpCommand,
  rejectArchiveBooleanFlag,
  rejectArchiveFlag,
} from "../helpers.js";

const LIBRARY_METADATA_ACTIONS = new Set([
  "clear",
  "delete",
  "get",
  "put",
  "set",
]);
const LIBRARY_SCOPE_ACTIONS = new Set(["create", "get", "list", "remove"]);

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

  if (values.help === true) {
    return {
      help: true,
      helpText: renderLibraryHelpText(uri, target),
      kind: "help",
    };
  }

  const action =
    explicitAction ?? (target.kind === "metadata" ? "get" : "list");
  if (!isLibraryAction(action)) {
    throw new Error(
      withHelpRoute(
        `The library URI target ${uri} does not support \`${action}\`.`,
        formatWikiGraphHelpCommand(uri),
      ),
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
  rejectCommonLibraryFlags(action, values, helpRoute);
  rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);

  switch (action) {
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
      return {
        args: { action, json: values.json, path: values.path, target },
        help: false,
        kind: "library",
      };
    case "remove":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      rejectArchiveFlag(action, "--path", values.path, helpRoute);
      return {
        args: { action, json: values.json, target },
        help: false,
        kind: "library",
      };
    case "get":
    case "list":
      rejectExtraPositionals(action, tail, 0, helpRoute);
      rejectArchiveFlag(action, "--path", values.path, helpRoute);
      return {
        args: { action, json: values.json, target },
        help: false,
        kind: "library",
      };
    case "set":
    case "put":
    case "delete":
    case "clear":
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
      throw new Error(
        "Internal error: scope action routed to library metadata.",
      );
  }
}

function rejectCommonLibraryFlags(
  action: string,
  values: ArchiveArgumentValues,
  helpRoute: string,
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
  rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
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
    action === "clear" ||
    action === "create" ||
    action === "delete" ||
    action === "get" ||
    action === "list" ||
    action === "put" ||
    action === "remove" ||
    action === "set"
  );
}

function renderLibraryHelpText(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
): string {
  if (target.kind === "metadata") {
    return [
      "Help Type: command",
      `Command: wg ${uri}`,
      "",
      "Library metadata object",
      "",
      "Usage:",
      `  wg ${uri}`,
      `  wg ${uri} set <json> [--json]`,
      `  wg ${uri} put <key> <value> [--json]`,
      `  wg ${uri} delete <key> [--json]`,
      `  wg ${uri} clear [--json]`,
    ].join("\n");
  }
  return [
    "Help Type: command",
    `Command: wg ${uri}`,
    "",
    "Library scope",
    "",
    "Usage:",
    ...(target.isDefault
      ? ["  wg wikg://lib create --path <folder> [--json]"]
      : []),
    `  wg ${uri}`,
    ...(target.isDefault ? [] : [`  wg ${uri} remove [--json]`]),
  ].join("\n");
}
