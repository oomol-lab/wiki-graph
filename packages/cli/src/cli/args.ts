import { parseArgs } from "util";

import { renderMainHelpText } from "./help.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./support/index.js";

export type * from "./args/index.js";
import type { ParsedCLIArguments } from "./args/index.js";

import {
  formatUnknownCommandMessage,
  isArchiveMaintenanceCommand,
  isPublicArchiveCommandHelpAction,
  isWikiGraphJobUri,
  isWikiGraphLocalConfigUri,
  isWikiGraphUri,
  normalizeArchiveValueFlagArgv,
  rejectArchiveBooleanFlag,
  rejectNonCreateReplaceFlag,
  rejectNonGcForceFlag,
  parseArchiveArguments,
  parseArchiveUriFirstArguments,
  parseJobUriFirstArguments,
} from "./args/index.js";
import {
  parseArchiveMaintenanceArguments,
  parseGcArguments,
  parseHelpArguments,
  parseLegacyArguments,
  parseLocalConfigUriFirstArguments,
  parseTransformArguments,
} from "./args/root/index.js";
export function parseCLIArguments(
  argv = process.argv.slice(2),
): ParsedCLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: normalizeArchiveValueFlagArgv(argv),
    options: {
      author: {
        multiple: true,
        type: "string",
      },
      after: {
        type: "string",
      },
      before: {
        type: "string",
      },
      backlinks: {
        type: "boolean",
      },
      budget: {
        type: "string",
      },
      clear: {
        type: "boolean",
      },
      "clear-authors": {
        type: "boolean",
      },
      "clear-description": {
        type: "boolean",
      },
      "clear-identifier": {
        type: "boolean",
      },
      "clear-language": {
        type: "boolean",
      },
      "clear-published-at": {
        type: "boolean",
      },
      "clear-publisher": {
        type: "boolean",
      },
      "clear-title": {
        type: "boolean",
      },
      description: {
        type: "string",
      },
      help: {
        short: "h",
        type: "boolean",
      },
      "digest-dir": {
        type: "string",
      },
      "dry-run": {
        type: "boolean",
      },
      active: {
        type: "boolean",
      },
      "accept-cost": {
        type: "boolean",
      },
      all: {
        type: "boolean",
      },
      boost: {
        type: "boolean",
      },
      first: {
        type: "boolean",
      },
      identifier: {
        type: "string",
      },
      from: {
        type: "string",
      },
      force: {
        type: "boolean",
      },
      input: {
        type: "string",
      },
      import: {
        type: "string",
      },
      "input-format": {
        type: "string",
      },
      limit: {
        type: "string",
      },
      language: {
        type: "string",
      },
      json: {
        type: "boolean",
      },
      "json-input": {
        type: "string",
      },
      jsonl: {
        type: "boolean",
      },
      llm: {
        type: "string",
      },
      output: {
        type: "string",
      },
      "output-format": {
        type: "string",
      },
      prompt: {
        type: "string",
      },
      query: {
        type: "string",
      },
      replace: {
        type: "boolean",
      },
      reverse: {
        type: "boolean",
      },
      stage: {
        type: "string",
      },
      task: {
        type: "string",
      },
      chapter: {
        type: "string",
      },
      confirm: {
        type: "boolean",
      },
      context: {
        type: "string",
      },
      cursor: {
        type: "string",
      },
      evidence: {
        type: "string",
      },
      parent: {
        type: "string",
      },
      "published-at": {
        type: "string",
      },
      publisher: {
        type: "string",
      },
      recursive: {
        type: "boolean",
      },
      secret: {
        type: "boolean",
      },
      role: {
        type: "string",
      },
      root: {
        type: "boolean",
      },
      last: {
        type: "boolean",
      },
      title: {
        type: "string",
      },
      to: {
        type: "string",
      },
      verbose: {
        short: "v",
        type: "boolean",
      },
      version: {
        type: "boolean",
      },
    },
    strict: true,
  });

  rejectNonGcForceFlag(positionals, values);
  rejectNonCreateReplaceFlag(positionals, values);

  if (values.version === true) {
    return {
      help: false,
      kind: "version",
    };
  }

  if (values.help === true && positionals.length === 0) {
    return {
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    };
  }

  if (
    values["accept-cost"] === true &&
    !(isWikiGraphJobUri(positionals[0]) && positionals[1] === "add")
  ) {
    throw new Error(
      withHelpRoute(
        "`--accept-cost` is only valid for `wg wikg://local/job add`.",
        "wg wikg://local/job add --help",
      ),
    );
  }

  if (
    values.reverse === true &&
    (positionals[0] === undefined ||
      (!isWikiGraphUri(positionals[0]) && positionals[0] !== "next"))
  ) {
    throw new Error("The current command does not support --reverse.");
  }

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "gc") {
    return parseGcArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "legacy") {
    return parseLegacyArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "transform") {
    return parseTransformArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "next") {
    return parseArchiveArguments("next", positionals.slice(1), values);
  }

  if (
    isArchiveMaintenanceCommand(positionals[0]) &&
    values.help === true &&
    positionals.length <= 2
  ) {
    return parseArchiveMaintenanceArguments(
      positionals[0],
      positionals.slice(1),
      values,
    );
  }

  if (isWikiGraphJobUri(positionals[0])) {
    rejectArchiveBooleanFlag(
      positionals[1] ?? "job",
      "--reverse",
      values.reverse,
      "wg wikg://local/job --help",
    );
    return parseJobUriFirstArguments(positionals, values);
  }

  if (isWikiGraphLocalConfigUri(positionals[0])) {
    rejectArchiveBooleanFlag(
      positionals[1] ?? "config",
      "--reverse",
      values.reverse,
      "wg wikg://local/config --help",
    );
    return parseLocalConfigUriFirstArguments(positionals, values);
  }

  if (isWikiGraphUri(positionals[0])) {
    return parseArchiveUriFirstArguments(positionals, values);
  }

  if (
    isPublicArchiveCommandHelpAction(positionals[0]) &&
    values.help === true &&
    positionals.length === 1
  ) {
    return parseArchiveArguments(positionals[0], positionals.slice(1), values);
  }

  if (positionals.length === 0) {
    throw new Error(withHelpRoute("Missing command.", CLI_HELP_ROUTES.command));
  }
  throw new Error(formatUnknownCommandMessage(positionals[0]!));
}
