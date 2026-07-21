import { parseArgs } from "util";

import { parseCLIFormat } from "./support/index.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./support/index.js";
import {
  isUriHelpPredicate,
  parseHelpTopic,
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderGcCommandHelpText,
  renderHelpTopicText,
  renderLegacyCommandHelpText,
  renderMainHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderTransformHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
} from "./help.js";
import type { LocalConfigSection } from "./local-config-store.js";

export type * from "./args/index.js";
import type {
  ArchiveArgumentValues,
  ArchiveMetaFlagValues,
  CLIArguments,
  CLIArchiveMaintenanceCommand,
  CLILocalConfigAction,
  ParsedCLIArguments,
} from "./args/index.js";

import {
  formatRemovedImplicitVerbMessage,
  formatUnknownCommandMessage,
  formatWikiGraphHelpCommand,
  isArchiveChapterAction,
  isArchiveMaintenanceCommand,
  isPublicArchiveCommandHelpAction,
  isRemovedImplicitArchiveAction,
  isWikiGraphJobUri,
  isWikiGraphLocalConfigUri,
  isWikiGraphUri,
  normalizeArchiveValueFlagArgv,
  parseChapterStage,
  parseLocalConfigUriSection,
  rejectArchiveBooleanFlag,
  rejectArchiveExtraPositionals,
  rejectCommandMetaFlags,
  rejectGcFlag,
  rejectGcMetaFlags,
  rejectHelpFlag,
  rejectHelpMetaFlags,
  rejectMetaCommandBooleanFlag,
  rejectMetaCommandFlag,
  rejectNonCreateReplaceFlag,
  rejectNonGcForceFlag,
  rejectTransformFlag,
  rejectTransformMetaFlags,
  parseArchiveArguments,
  parseArchiveUriFirstArguments,
  parseJobUriFirstArguments,
} from "./args/index.js";
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

function parseLocalConfigUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];

  if (uri === undefined) {
    throw new Error("Internal error: missing local config URI.");
  }

  const section = parseLocalConfigUriSection(uri);
  const explicitAction = positionals[1];

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  const action = explicitAction ?? "get";
  const helpRoute =
    explicitAction === undefined
      ? formatWikiGraphHelpCommand(uri)
      : formatWikiGraphHelpCommand(uri, action);

  if (section === undefined) {
    throw new Error(
      withHelpRoute(
        "Expected a local config section URI such as wikg://local/config/llm.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }
  if (values.help === true && explicitAction === undefined) {
    return {
      help: true,
      helpText: renderUriHelpText("local-config-section", uri),
      kind: "help",
    };
  }
  if (values.help === true && explicitAction !== undefined) {
    if (!isUriHelpPredicate("local-config-section", action)) {
      throw new Error(
        withHelpRoute(
          `The URI target ${uri} does not support \`${action}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText("local-config-section", action, uri),
      kind: "help",
    };
  }
  if (!isLocalConfigAction(action)) {
    throw new Error(
      withHelpRoute(
        `The local config URI form does not support \`${action}\`. Pass the URI directly to read it, or use set, put, delete, clear, or test.`,
        helpRoute,
      ),
    );
  }

  return parseLocalConfigArguments(
    section,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
    helpRoute,
  );
}

function parseLocalConfigArguments(
  section: LocalConfigSection,
  action: CLILocalConfigAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  rejectLocalConfigFlags(action, values, helpRoute);

  switch (action) {
    case "get":
    case "clear":
    case "test":
      rejectArchiveExtraPositionals(action, tail, 0, helpRoute);
      break;
    case "delete":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      break;
    case "put":
      rejectArchiveExtraPositionals(
        action,
        tail,
        values.secret === true ? 1 : 2,
        helpRoute,
      );
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      if (
        values.secret !== true &&
        tail[1] === undefined &&
        values["json-input"] === undefined
      ) {
        throw new Error(withHelpRoute("Missing config value.", helpRoute));
      }
      break;
    case "set":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      break;
  }

  return {
    args: {
      action,
      ...(tail[0] === undefined || (action !== "put" && action !== "delete")
        ? {}
        : { key: tail[0] }),
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values["json-input"] === undefined
        ? {}
        : { jsonInputValue: values["json-input"] }),
      ...(action !== "set" && action !== "put"
        ? {}
        : tail[action === "put" ? 1 : 0] === undefined
          ? {}
          : { inputValue: tail[action === "put" ? 1 : 0] }),
      section,
      ...(values.secret === undefined ? {} : { secret: values.secret }),
    },
    help: false,
    kind: "local-config",
  };
}

function rejectLocalConfigFlags(
  action: CLILocalConfigAction,
  values: ArchiveArgumentValues,
  helpRoute: string,
): void {
  rejectMetaCommandFlag("input", values.input, helpRoute);
  rejectMetaCommandFlag("llm", values.llm, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("task", values.task, helpRoute);
  rejectMetaCommandBooleanFlag("jsonl", values.jsonl, helpRoute);
  rejectMetaCommandBooleanFlag("verbose", values.verbose, helpRoute);
  rejectCommandMetaFlags(values, action, helpRoute);

  if (values.secret === true && action !== "put") {
    throw new Error(
      withHelpRoute("`--secret` is only valid for config put.", helpRoute),
    );
  }
  if (action === "get" || action === "test") {
    return;
  }
  if (values.json === true && action !== "set" && action !== "put") {
    throw new Error(
      withHelpRoute(`\`${action}\` does not support --json.`, helpRoute),
    );
  }
}

function isLocalConfigAction(
  value: string | undefined,
): value is CLILocalConfigAction {
  return (
    value === "clear" ||
    value === "delete" ||
    value === "get" ||
    value === "put" ||
    value === "set" ||
    value === "test"
  );
}

function parseTransformArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wg transform --help";

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }
  rejectTransformMetaFlags(values);
  rejectTransformFlag("budget", values.budget, helpRoute);
  rejectTransformFlag("chapter", values.chapter, helpRoute);
  rejectTransformFlag("confirm", values.confirm, helpRoute);
  rejectTransformFlag("cursor", values.cursor, helpRoute);
  rejectTransformFlag("evidence", values.evidence, helpRoute);
  rejectTransformFlag("json", values.json, helpRoute);
  rejectTransformFlag("import", values.import, helpRoute);
  rejectTransformFlag("limit", values.limit, helpRoute);
  rejectTransformFlag("parent", values.parent, helpRoute);
  rejectTransformFlag("to", values.to, helpRoute);

  const args = {
    ...(values["digest-dir"] === undefined
      ? {}
      : { digestDirPath: values["digest-dir"] }),
    help: values.help ?? false,
    ...(values.input === undefined ? {} : { inputPath: values.input }),
    ...(values["input-format"] === undefined
      ? {}
      : {
          inputFormat: parseCLIFormat(values["input-format"], "--input-format"),
        }),
    ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    ...(values.output === undefined ? {} : { outputPath: values.output }),
    ...(values["output-format"] === undefined
      ? {}
      : {
          outputFormat: parseCLIFormat(
            values["output-format"],
            "--output-format",
          ),
        }),
    ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
    ...(values.stage === undefined
      ? {}
      : {
          targetStage: parseChapterStage(values.stage, "--stage", helpRoute),
        }),
    verbose: values.verbose ?? false,
  } satisfies CLIArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText: renderTransformHelpText(),
      kind: "convert",
    };
  }

  return {
    args,
    help: false,
    kind: "convert",
  };
}

function parseGcArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues & ArchiveMetaFlagValues,
): ParsedCLIArguments {
  const helpRoute = "wg gc --help";

  if (values.help === true) {
    return {
      help: true,
      helpText: renderGcCommandHelpText(),
      kind: "help",
    };
  }

  rejectGcFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectGcFlag("import", values.import, helpRoute);
  rejectGcFlag("input", values.input, helpRoute);
  rejectGcFlag("input-format", values["input-format"], helpRoute);
  rejectGcFlag("jsonl", values.jsonl, helpRoute);
  rejectGcFlag("limit", values.limit, helpRoute);
  rejectGcFlag("llm", values.llm, helpRoute);
  rejectGcFlag("output", values.output, helpRoute);
  rejectGcFlag("output-format", values["output-format"], helpRoute);
  rejectGcFlag("prompt", values.prompt, helpRoute);
  rejectGcFlag("stage", values.stage, helpRoute);
  rejectGcMetaFlags(values);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute("The `gc` command does not support --verbose.", helpRoute),
    );
  }
  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`gc\`: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: {
      ...(values["dry-run"] === undefined ? {} : { dryRun: values["dry-run"] }),
      ...(values.force === undefined ? {} : { force: values.force }),
      ...(values.json === undefined ? {} : { json: values.json }),
    },
    help: false,
    kind: "gc",
  };
}

function parseLegacyArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const action = positionals[0];

  if (values.help === true && action === undefined) {
    return {
      help: true,
      helpText: renderLegacyCommandHelpText(),
      kind: "help",
    };
  }
  if (action === "migrate") {
    if (values.help === true) {
      return {
        help: true,
        helpText: renderLegacyCommandHelpText("migrate"),
        kind: "help",
      };
    }

    rejectLegacyFlag("--input", values.input);
    rejectLegacyFlag("--import", values.import);
    rejectLegacyFlag("--input-format", values["input-format"]);
    rejectLegacyFlag("--output-format", values["output-format"]);
    rejectLegacyFlag("--llm", values.llm);
    rejectLegacyFlag("--prompt", values.prompt);
    rejectLegacyBooleanFlag("--json", values.json);
    rejectLegacyBooleanFlag("--jsonl", values.jsonl);
    rejectLegacyBooleanFlag("--verbose", values.verbose);

    const inputPath = positionals[1];

    if (inputPath === undefined) {
      throw new Error(
        withHelpRoute("Missing legacy input path.", "wg legacy migrate --help"),
      );
    }
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          "wg legacy migrate --help",
        ),
      );
    }

    return {
      args: {
        action,
        inputPath,
        ...(values.output === undefined ? {} : { outputPath: values.output }),
      },
      help: false,
      kind: "legacy",
    };
  }

  throw new Error(
    withHelpRoute(
      action === undefined
        ? "Missing legacy command."
        : `Invalid legacy command: ${action}.`,
      "wg legacy --help",
    ),
  );
}

function rejectLegacyFlag(flag: string, value: unknown): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `\`wg legacy migrate\` does not support ${flag}.`,
        "wg legacy migrate --help",
      ),
    );
  }
}

function rejectLegacyBooleanFlag(
  flag: string,
  value: boolean | undefined,
): void {
  if (value === true) {
    rejectLegacyFlag(flag, value);
  }
}

function parseArchiveMaintenanceArguments(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  if (values.help !== true) {
    throw new Error(
      withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command),
    );
  }

  switch (command) {
    case "cover":
    case "meta":
      if (positionals.length > 0) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceCommandHelpText(command),
        kind: "maintenance",
      };
    case "chapter": {
      const action = positionals[0];
      if (action === undefined) {
        return {
          help: true,
          helpText: renderArchiveMaintenanceCommandHelpText("chapter"),
          kind: "chapter",
        };
      }
      if (!isArchiveChapterAction(action)) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Use the chapter collection URI directly, add --query, or use add, move, remove, reset, or tree. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (
        action === "set-source" ||
        action === "set-summary" ||
        action === "set-title"
      ) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (positionals.length > 1) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceChapterActionHelpText(action),
        kind: "chapter",
      };
    }
  }
}

function parseHelpArguments(
  positionals: readonly string[],
  values: {
    readonly author?: readonly string[];
    readonly "clear-authors"?: boolean;
    readonly "clear-description"?: boolean;
    readonly "clear-identifier"?: boolean;
    readonly "clear-language"?: boolean;
    readonly "clear-published-at"?: boolean;
    readonly "clear-publisher"?: boolean;
    readonly "clear-title"?: boolean;
    readonly description?: string;
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly import?: string;
    readonly identifier?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly language?: string;
    readonly limit?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly stage?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectHelpFlag("digest-dir", values["digest-dir"]);
  rejectHelpFlag("import", values.import);
  rejectHelpFlag("input", values.input);
  rejectHelpFlag("input-format", values["input-format"]);
  rejectHelpFlag("json", values.json);
  rejectHelpFlag("limit", values.limit);
  rejectHelpFlag("llm", values.llm);
  rejectHelpFlag("output", values.output);
  rejectHelpFlag("output-format", values["output-format"]);
  rejectHelpFlag("prompt", values.prompt);
  rejectHelpFlag("stage", values.stage);
  rejectHelpMetaFlags(values);

  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `help` command does not support --verbose.",
        CLI_HELP_ROUTES.root,
      ),
    );
  }

  if (positionals.length > 1) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }

  if (positionals[0] === undefined) {
    return {
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    };
  }

  if (isPublicArchiveCommandHelpAction(positionals[0])) {
    return {
      help: true,
      helpText: renderArchiveCommandHelpText(positionals[0]),
      kind: "help",
    };
  }

  return {
    help: true,
    helpText: renderHelpTopicText(parseHelpTopic(positionals[0])),
    kind: "help",
  };
}
