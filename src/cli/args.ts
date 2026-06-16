import { parseArgs } from "util";

import { type CLIFormat, parseCLIFormat } from "./formats.js";
import {
  CLI_HELP_ROUTES,
  archiveMaintenanceHelpRoute,
  withHelpRoute,
} from "./errors.js";
import { CHAPTER_STAGES, type ChapterStage } from "../facade/index.js";
import {
  parseHelpTopic,
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpTopicText,
  renderMainHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderStatusHelpText,
  renderTransformHelpText,
} from "./help.js";

export interface CLIArguments {
  readonly digestDirPath?: string;
  readonly help: boolean;
  readonly inputPath?: string;
  readonly inputFormat?: CLIFormat;
  readonly llmJSON?: string;
  readonly outputPath?: string;
  readonly outputFormat?: CLIFormat;
  readonly prompt?: string;
  readonly targetStage?: ChapterStage;
  readonly verbose: boolean;
}

export interface CLIArchiveMetadataArguments {
  readonly inputPath: string;
  readonly json?: boolean;
  readonly llmJSON?: string;
  readonly metaPatch?: ArchiveMetaPatch;
}

export interface CLIArchiveCoverArguments {
  readonly inputPath: string;
  readonly llmJSON?: string;
}

export interface ArchiveMetaPatch {
  readonly authors?: readonly string[];
  readonly clearAuthors?: boolean;
  readonly clearDescription?: boolean;
  readonly clearIdentifier?: boolean;
  readonly clearLanguage?: boolean;
  readonly clearPublishedAt?: boolean;
  readonly clearPublisher?: boolean;
  readonly clearTitle?: boolean;
  readonly description?: string;
  readonly identifier?: string;
  readonly language?: string;
  readonly publishedAt?: string;
  readonly publisher?: string;
  readonly title?: string;
}

export type CLIArchiveChapterAction =
  | "add"
  | "generate-graph"
  | "generate-summary"
  | "list"
  | "remove"
  | "reset"
  | "set-source"
  | "set-summary"
  | "status";

export interface CLIArchiveChapterArguments {
  readonly action: CLIArchiveChapterAction;
  readonly chapterId?: number;
  readonly inputFormat?: Extract<CLIFormat, "markdown" | "txt">;
  readonly inputPath?: string;
  readonly llmJSON?: string;
  readonly parentChapterId?: number;
  readonly path: string;
  readonly prompt?: string;
  readonly recursive?: boolean;
  readonly resetStage?: Exclude<ChapterStage, "summarized">;
  readonly title?: string;
}

export interface CLIStatusArguments {
  readonly llmJSON?: string;
}

export type CLIArchiveAction =
  | "backlinks"
  | "build"
  | "estimate"
  | "evidence"
  | "export"
  | "find"
  | "grep"
  | "import"
  | "index"
  | "links"
  | "list"
  | "ls"
  | "map"
  | "page"
  | "pack"
  | "path"
  | "read"
  | "related"
  | "status";

export type CLIArchiveMaintenanceCommand = "chapter" | "cover" | "meta";

export interface CLIArchiveArguments {
  readonly action: CLIArchiveAction;
  readonly archivePath: string;
  readonly budget?: number;
  readonly chapters?: readonly number[];
  readonly chapterId?: number;
  readonly confirm?: boolean;
  readonly cursor?: string;
  readonly fromNodeId?: number;
  readonly inputFormat?: CLIFormat;
  readonly json?: boolean;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly match?: "all" | "any";
  readonly listKind?:
    | "chapters"
    | "edges"
    | "evidence"
    | "fragments"
    | "meta"
    | "nodes"
    | "summaries";
  readonly llmJSON?: string;
  readonly objectId?: string;
  readonly outputFormat?: CLIFormat;
  readonly outputPath?: string;
  readonly prompt?: string;
  readonly query?: string;
  readonly searchOrder?: "doc-asc" | "doc-desc";
  readonly searchTypes?: readonly (
    | "chapter"
    | "fragment"
    | "meta"
    | "node"
    | "sentence"
    | "summary"
  )[];
  readonly sourcePath?: string;
  readonly targetStage?: ChapterStage | "ready" | "source";
  readonly toNodeId?: number;
}

interface ArchiveMetaFlagValues {
  readonly author?: readonly string[];
  readonly "clear-authors"?: boolean;
  readonly "clear-description"?: boolean;
  readonly "clear-identifier"?: boolean;
  readonly "clear-language"?: boolean;
  readonly "clear-published-at"?: boolean;
  readonly "clear-publisher"?: boolean;
  readonly "clear-title"?: boolean;
  readonly description?: string;
  readonly identifier?: string;
  readonly language?: string;
  readonly "published-at"?: string;
  readonly publisher?: string;
  readonly title?: string;
}

interface ArchiveArgumentValues extends ArchiveMetaFlagValues {
  readonly budget?: string;
  readonly chapter?: string;
  readonly confirm?: boolean;
  readonly cursor?: string;
  readonly "digest-dir"?: string;
  readonly help?: boolean;
  readonly input?: string;
  readonly "input-format"?: string;
  readonly id?: string;
  readonly json?: boolean;
  readonly limit?: string;
  readonly llm?: string;
  readonly match?: string;
  readonly output?: string;
  readonly "output-format"?: string;
  readonly order?: string;
  readonly prompt?: string;
  readonly stage?: string;
  readonly type?: string;
  readonly to?: string;
  readonly verbose?: boolean;
}

export type ParsedCLIArguments =
  | {
      readonly help: false;
      readonly kind: "version";
    }
  | {
      readonly args: CLIArguments;
      readonly help: false;
      readonly kind: "convert";
    }
  | {
      readonly args: CLIArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "convert";
    }
  | {
      readonly args: CLIArchiveMetadataArguments;
      readonly help: false;
      readonly kind: "meta";
    }
  | {
      readonly args: CLIArchiveCoverArguments;
      readonly help: false;
      readonly kind: "cover";
    }
  | {
      readonly args?: CLIArchiveMetadataArguments | CLIArchiveCoverArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "maintenance";
    }
  | {
      readonly args: CLIArchiveChapterArguments;
      readonly help: false;
      readonly kind: "chapter";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "chapter";
    }
  | {
      readonly args: CLIArchiveArguments;
      readonly help: false;
      readonly kind: "archive";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "help";
    }
  | {
      readonly args: CLIStatusArguments;
      readonly help: false;
      readonly kind: "config-status";
    }
  | {
      readonly args: CLIStatusArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "config-status";
    };

export function parseCLIArguments(
  argv = process.argv.slice(2),
): ParsedCLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      author: {
        multiple: true,
        type: "string",
      },
      budget: {
        type: "string",
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
      identifier: {
        type: "string",
      },
      id: {
        type: "string",
      },
      input: {
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
      llm: {
        type: "string",
      },
      match: {
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
      stage: {
        type: "string",
      },
      chapter: {
        type: "string",
      },
      confirm: {
        type: "boolean",
      },
      cursor: {
        type: "string",
      },
      order: {
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
      title: {
        type: "string",
      },
      type: {
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

  if (values.version === true) {
    return {
      help: false,
      kind: "version",
    };
  }

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "config") {
    return parseConfigArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "transform") {
    return parseConvertArguments(positionals.slice(1), values, "transform");
  }

  if (isArchiveMaintenanceCommand(positionals[0])) {
    return parseArchiveMaintenanceArguments(
      positionals[0],
      positionals.slice(1),
      values,
    );
  }

  if (isArchiveAction(positionals[0])) {
    return parseArchiveArguments(positionals[0], positionals.slice(1), values);
  }

  return parseConvertArguments(positionals, values, "bare");
}

function parseConvertArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
  command: "bare" | "transform",
): ParsedCLIArguments {
  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional argument or unknown command: ${positionals.join(" ")}. The direct digest command reads from stdin or --input; it does not accept positional input paths. Use \`spinedigest transform --input <path>\`, or see available subcommands with \`spinedigest --help\`.`,
        CLI_HELP_ROUTES.command,
      ),
    );
  }
  rejectConvertMetaFlags(values);
  rejectConvertFlag("budget", values.budget);
  rejectConvertFlag("confirm", values.confirm);
  rejectConvertFlag("json", values.json);

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
          targetStage: parseChapterStage(
            values.stage,
            "--stage",
            CLI_HELP_ROUTES.command,
          ),
        }),
    verbose: values.verbose ?? false,
  } satisfies CLIArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText:
        command === "transform"
          ? renderTransformHelpText()
          : renderMainHelpText(),
      kind: "convert",
    };
  }

  return {
    args,
    help: false,
    kind: "convert",
  };
}

function parseConfigArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues & ArchiveMetaFlagValues,
): ParsedCLIArguments {
  const action = positionals[0];

  if (values.help === true && action === undefined) {
    return {
      args: {},
      help: true,
      helpText: renderStatusHelpText(),
      kind: "config-status",
    };
  }

  if (action !== "status") {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing config action. Expected status."
          : `Invalid config action: ${action}. Expected status.`,
        "spinedigest config status --help",
      ),
    );
  }

  return parseConfigStatusArguments(positionals.slice(1), values);
}

function parseArchiveMaintenanceArguments(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  switch (command) {
    case "chapter":
      return parseArchiveChapterArguments(positionals, values);
    case "cover":
      return parseArchiveCoverArguments(positionals, values);
    case "meta":
      return parseArchiveMetaArguments(positionals, values);
  }
}

function parseArchiveMetaArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "spinedigest meta --help";

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("meta"),
      kind: "maintenance",
    };
  }

  const archivePath = positionals[0];
  if (archivePath === undefined || archivePath === "-") {
    throw new Error(
      withHelpRoute(
        "Missing archive path. Use `spinedigest meta <archive.sdpub>`.",
        helpRoute,
      ),
    );
  }
  rejectArchiveMaintenanceExtraPositionals("meta", positionals, 1, helpRoute);
  rejectMetaCommandFlag("budget", values.budget, helpRoute);
  rejectMetaCommandFlag("chapter", values.chapter, helpRoute);
  rejectMetaCommandFlag("cursor", values.cursor, helpRoute);
  rejectMetaCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectMetaCommandFlag("id", values.id, helpRoute);
  rejectMetaCommandFlag("input", values.input, helpRoute);
  rejectMetaCommandFlag("input-format", values["input-format"], helpRoute);
  rejectMetaCommandFlag("limit", values.limit, helpRoute);
  rejectMetaCommandFlag("match", values.match, helpRoute);
  rejectMetaCommandFlag("order", values.order, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("output-format", values["output-format"], helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("stage", values.stage, helpRoute);
  rejectMetaCommandFlag("to", values.to, helpRoute);
  rejectMetaCommandFlag("type", values.type, helpRoute);
  rejectMetaCommandBooleanFlag("confirm", values.confirm, helpRoute);
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The `meta` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  const metaPatch = parseArchiveMetaPatch(values, "meta");
  if (values.json === true && metaPatch !== undefined) {
    throw new Error(
      withHelpRoute(
        "`meta --json` is read-only and cannot be combined with metadata edit flags.",
        helpRoute,
      ),
    );
  }

  return {
    args: {
      inputPath: archivePath,
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      ...(metaPatch === undefined ? {} : { metaPatch }),
    },
    help: false,
    kind: "meta",
  };
}

function parseArchiveCoverArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "spinedigest cover --help";

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("cover"),
      kind: "maintenance",
    };
  }

  const archivePath = positionals[0];
  if (archivePath === undefined || archivePath === "-") {
    throw new Error(
      withHelpRoute(
        "Missing archive path. Use `spinedigest cover <archive.sdpub>`.",
        helpRoute,
      ),
    );
  }
  rejectArchiveMaintenanceExtraPositionals("cover", positionals, 1, helpRoute);
  rejectCoverCommandFlag("budget", values.budget, helpRoute);
  rejectCoverCommandFlag("chapter", values.chapter, helpRoute);
  rejectCoverCommandFlag("cursor", values.cursor, helpRoute);
  rejectCoverCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectCoverCommandFlag("id", values.id, helpRoute);
  rejectCoverCommandFlag("input", values.input, helpRoute);
  rejectCoverCommandFlag("input-format", values["input-format"], helpRoute);
  rejectCoverCommandFlag("limit", values.limit, helpRoute);
  rejectCoverCommandFlag("match", values.match, helpRoute);
  rejectCoverCommandFlag("order", values.order, helpRoute);
  rejectCoverCommandFlag("output", values.output, helpRoute);
  rejectCoverCommandFlag("output-format", values["output-format"], helpRoute);
  rejectCoverCommandFlag("prompt", values.prompt, helpRoute);
  rejectCoverCommandFlag("stage", values.stage, helpRoute);
  rejectCoverCommandFlag("to", values.to, helpRoute);
  rejectCoverCommandFlag("type", values.type, helpRoute);
  rejectCoverCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectCoverCommandBooleanFlag("json", values.json, helpRoute);
  rejectCoverMetaFlags(values);
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The `cover` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  return {
    args: {
      inputPath: archivePath,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    },
    help: false,
    kind: "cover",
  };
}

function parseArchiveArguments(
  action: CLIArchiveAction,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const normalized = normalizeArchiveInlineOptions(positionals, values);

  positionals = normalized.positionals;
  values = normalized.values;

  const archivePath = positionals[0];
  const helpRoute = `spinedigest ${action} --help`;

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveCommandHelpText(action),
      kind: "help",
    };
  }

  if (archivePath === undefined || archivePath === "-") {
    throw new Error(
      withHelpRoute(
        `Missing archive path. Use \`spinedigest ${action} <archive.sdpub>\`.`,
        helpRoute,
      ),
    );
  }

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support --verbose.`,
        helpRoute,
      ),
    );
  }

  switch (action) {
    case "import": {
      const rawSourcePath = positionals[1] ?? values.input;
      const sourcePath = rawSourcePath === "-" ? undefined : rawSourcePath;
      const inputFormat =
        values["input-format"] === undefined
          ? undefined
          : parseCLIFormat(values["input-format"], "--input-format");

      if (sourcePath === undefined && inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "`spinedigest import` requires a source path, or --input-format when reading source text from stdin.",
            helpRoute,
          ),
        );
      }
      if (
        sourcePath === undefined &&
        inputFormat !== undefined &&
        inputFormat !== "markdown" &&
        inputFormat !== "txt"
      ) {
        throw new Error(
          withHelpRoute(
            "stdin import only supports --input-format markdown or txt.",
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveFlag(action, "--output", values.output, helpRoute);
      rejectArchiveFlag(
        action,
        "--output-format",
        values["output-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(inputFormat === undefined ? {} : { inputFormat }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
          ...(sourcePath === undefined ? {} : { sourcePath }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "build": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--output", values.output, helpRoute);
      rejectArchiveFlag(
        action,
        "--output-format",
        values["output-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      const targetStage = parseArchiveBuildStage(values.stage ?? values.to);

      if (targetStage !== "sourced" && values.confirm !== true) {
        throw new Error(
          withHelpRoute(
            "This build may call an LLM. Run `spinedigest estimate <archive.sdpub> --stage ready`, then rerun build with --confirm.",
            helpRoute,
          ),
        );
      }

      return {
        args: {
          action,
          archivePath,
          ...(values.chapter === undefined
            ? {}
            : {
                chapterId: parseSerialId(
                  values.chapter,
                  "--chapter",
                  helpRoute,
                ),
              }),
          ...(values.confirm === undefined ? {} : { confirm: values.confirm }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
          targetStage,
        },
        help: false,
        kind: "archive",
      };
    }
    case "export":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.output === undefined ? {} : { outputPath: values.output }),
          outputFormat:
            values["output-format"] === undefined
              ? parseCLIFormat("markdown", "--output-format")
              : parseCLIFormat(values["output-format"], "--output-format"),
        },
        help: false,
        kind: "archive",
      };
    case "estimate":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.json === undefined ? {} : { json: values.json }),
          targetStage: parseArchiveEstimateStage(values.stage ?? values.to),
        },
        help: false,
        kind: "archive",
      };
    case "status":
    case "index":
    case "map":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.json === undefined ? {} : { json: values.json }),
        },
        help: false,
        kind: "archive",
      };
    case "ls": {
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      const listKind = parseArchiveListKind(positionals[1]);

      return {
        args: {
          action,
          archivePath,
          ...(values.json === undefined ? {} : { json: values.json }),
          listKind,
        },
        help: false,
        kind: "archive",
      };
    }
    case "list": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.chapter === undefined
            ? {}
            : { chapters: parseArchiveSearchChapters(values.chapter) }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...(values.id === undefined
            ? {}
            : { ids: parseArchiveIds(values.id) }),
          ...(values.json === undefined ? {} : { json: values.json }),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          ...(values.order === undefined
            ? {}
            : { searchOrder: parseArchiveSearchOrder(values.order) }),
          ...(values.type === undefined
            ? {}
            : { searchTypes: parseArchiveCollectionTypes(values.type) }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "find":
    case "grep": {
      const query = positionals[1];

      if (query === undefined) {
        throw new Error(
          withHelpRoute(
            `\`spinedigest ${action}\` requires a search query.`,
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      if (action === "grep") {
        rejectArchiveFlag(action, "--match", values.match, helpRoute);
      }
      return {
        args: {
          action,
          archivePath,
          ...(values.chapter === undefined
            ? {}
            : { chapters: parseArchiveSearchChapters(values.chapter) }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...(values.json === undefined ? {} : { json: values.json }),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          query,
          ...(action === "find" && values.match !== undefined
            ? { match: parseArchiveFindMatch(values.match) }
            : {}),
          ...(values.order === undefined
            ? {}
            : { searchOrder: parseArchiveSearchOrder(values.order) }),
          ...(values.type === undefined
            ? {}
            : { searchTypes: parseArchiveSearchTypes(values.type) }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "read":
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      if (positionals[1] === undefined) {
        throw new Error(
          withHelpRoute("`spinedigest read` requires an object id.", helpRoute),
        );
      }
      return {
        args: {
          action,
          archivePath,
          objectId: positionals[1],
        },
        help: false,
        kind: "archive",
      };
    case "page":
    case "evidence":
    case "links":
    case "backlinks":
    case "related": {
      const objectId = positionals[1];

      if (objectId === undefined) {
        throw new Error(
          withHelpRoute(
            `\`spinedigest ${action}\` requires an object id.`,
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.json === undefined ? {} : { json: values.json }),
          objectId,
        },
        help: false,
        kind: "archive",
      };
    }
    case "pack": {
      const objectId = positionals[1];

      if (objectId === undefined) {
        throw new Error(
          withHelpRoute("`spinedigest pack` requires an object id.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      return {
        args: {
          action,
          archivePath,
          budget:
            values.budget === undefined
              ? 5000
              : parsePositiveIntegerFlag(values.budget, "--budget", helpRoute),
          ...(values.json === undefined ? {} : { json: values.json }),
          objectId,
        },
        help: false,
        kind: "archive",
      };
    }
    case "path": {
      const from = positionals[1];
      const to = positionals[2];

      if (from === undefined || to === undefined) {
        throw new Error(
          withHelpRoute("`spinedigest path` requires two node ids.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 3, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      const fromNodeId = parseNodeObjectId(from, helpRoute);
      const toNodeId = parseNodeObjectId(to, helpRoute);
      const chapterId =
        values.chapter === undefined
          ? undefined
          : parseSerialId(values.chapter, "--chapter", helpRoute);

      if (chapterId === undefined) {
        throw new Error(
          withHelpRoute(
            "`spinedigest path` requires --chapter because graph paths are chapter-scoped.",
            helpRoute,
          ),
        );
      }

      return {
        args: {
          action,
          archivePath,
          chapterId,
          fromNodeId,
          ...(values.json === undefined ? {} : { json: values.json }),
          toNodeId,
        },
        help: false,
        kind: "archive",
      };
    }
  }
}

function parseArchiveChapterArguments(
  positionals: readonly string[],
  values: {
    readonly author?: readonly string[];
    readonly chapter?: string;
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
    readonly identifier?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly language?: string;
    readonly limit?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly parent?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const action = positionals[0];
  const path = positionals[1];
  const helpRoute = "spinedigest chapter --help";

  rejectArchiveChapterFlag("digest-dir", values["digest-dir"]);
  rejectArchiveChapterFlag("json", values.json);
  rejectArchiveChapterFlag("limit", values.limit);
  rejectArchiveChapterFlag("output", values.output);
  rejectArchiveChapterFlag("output-format", values["output-format"]);
  rejectArchiveChapterFlag("stage", values.stage);
  rejectArchiveChapterMetaFlags(values);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `chapter` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  if (help && isArchiveChapterAction(action)) {
    if (action === "generate-graph" || action === "generate-summary") {
      return {
        help: true,
        helpText: renderArchiveMaintenanceCommandHelpText("chapter"),
        kind: "chapter",
      };
    }

    return {
      help: true,
      helpText: renderArchiveMaintenanceChapterActionHelpText(action),
      kind: "chapter",
    };
  }

  if (help && action === undefined) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("chapter"),
      kind: "chapter",
    };
  }

  if (!isArchiveChapterAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing chapter action."
          : `Invalid chapter action: ${action}. Expected one of list, status, add, remove, reset, set-source, set-summary.`,
        helpRoute,
      ),
    );
  }
  if (path === undefined || path === "-") {
    throw new Error(
      withHelpRoute(
        "`spinedigest chapter` requires a .sdpub path positional argument.",
        helpRoute,
      ),
    );
  }
  if (positionals.length > 2) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: normalizeArchiveChapterArguments(action, path, values, helpRoute),
    help: false,
    kind: "chapter",
  };
}

function normalizeArchiveChapterArguments(
  action: CLIArchiveChapterAction,
  path: string,
  values: {
    readonly chapter?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly llm?: string;
    readonly parent?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly title?: string;
    readonly to?: string;
  },
  helpRoute: string,
): CLIArchiveChapterArguments {
  const chapterId =
    values.chapter === undefined
      ? undefined
      : parseSerialId(values.chapter, "--chapter", helpRoute);
  const parentChapterId =
    values.parent === undefined
      ? undefined
      : parseSerialId(values.parent, "--parent", helpRoute);
  const inputFormat =
    values["input-format"] === undefined
      ? undefined
      : parseChapterInputFormat(values["input-format"], helpRoute);
  const resetStage =
    values.to === undefined ? undefined : parseResetStage(values.to, helpRoute);

  switch (action) {
    case "add":
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        ...(values.title === undefined ? {} : { title: values.title }),
      };
    case "generate-graph":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
      };
    case "generate-summary":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "list":
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "remove":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      return {
        action,
        chapterId,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(values.recursive === undefined
          ? {}
          : { recursive: values.recursive }),
      };
    case "reset":
      requireChapterId(chapterId, action, helpRoute);
      if (resetStage === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --to. `chapter reset` requires planned, sourced, or graphed.",
            helpRoute,
          ),
        );
      }
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        resetStage,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-source":
      requireChapterId(chapterId, action, helpRoute);
      if (inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --input-format. `chapter set-source` requires txt or markdown.",
            helpRoute,
          ),
        );
      }
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        inputFormat,
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-summary":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "status":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
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

  if (isArchiveAction(positionals[0])) {
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

function parseConfigStatusArguments(
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
  rejectStatusFlag("digest-dir", values["digest-dir"]);
  rejectStatusFlag("input", values.input);
  rejectStatusFlag("input-format", values["input-format"]);
  rejectStatusFlag("json", values.json);
  rejectStatusFlag("limit", values.limit);
  rejectStatusFlag("output", values.output);
  rejectStatusFlag("output-format", values["output-format"]);
  rejectStatusFlag("prompt", values.prompt);
  rejectStatusFlag("stage", values.stage);
  rejectStatusMetaFlags(values);

  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `config status` command does not support --verbose.",
        "spinedigest config status --help",
      ),
    );
  }

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        "spinedigest config status --help",
      ),
    );
  }

  const args = {
    ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
  } satisfies CLIStatusArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText: renderStatusHelpText(),
      kind: "config-status",
    };
  }

  return {
    args,
    help: false,
    kind: "config-status",
  };
}

function parseSerialId(value: string, flag: string, helpRoute: string): number {
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

function isArchiveChapterAction(
  value: string | undefined,
): value is CLIArchiveChapterAction {
  return (
    value === "add" ||
    value === "generate-graph" ||
    value === "generate-summary" ||
    value === "list" ||
    value === "remove" ||
    value === "reset" ||
    value === "set-source" ||
    value === "set-summary" ||
    value === "status"
  );
}

function isArchiveMaintenanceCommand(
  value: string | undefined,
): value is CLIArchiveMaintenanceCommand {
  return value === "chapter" || value === "cover" || value === "meta";
}

function parseChapterStage(
  value: string,
  flag: string,
  helpRoute: string,
): ChapterStage {
  const normalized = value.trim().toLowerCase();

  if (CHAPTER_STAGES.includes(normalized as ChapterStage)) {
    return normalized as ChapterStage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid ${flag}: ${value}. Expected planned, sourced, graphed, or summarized.`,
      helpRoute,
    ),
  );
}

function parseChapterInputFormat(
  value: string,
  helpRoute: string,
): Extract<CLIFormat, "markdown" | "txt"> {
  const format = parseCLIFormat(value, "--input-format");

  if (format === "markdown" || format === "txt") {
    return format;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --input-format for chapter source: ${value}. Expected txt or markdown.`,
      helpRoute,
    ),
  );
}

function parseResetStage(
  value: string,
  helpRoute: string,
): Exclude<ChapterStage, "summarized"> {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "planned" ||
    normalized === "sourced" ||
    normalized === "graphed"
  ) {
    return normalized;
  }
  if (CHAPTER_STAGES.includes(normalized as ChapterStage)) {
    throw new Error(
      withHelpRoute(
        "`chapter reset` does not support --to summarized.",
        helpRoute,
      ),
    );
  }

  throw new Error(
    withHelpRoute(
      `Invalid --to: ${value}. Expected planned, sourced, or graphed.`,
      helpRoute,
    ),
  );
}

function parseArchiveMetaPatch(
  values: ArchiveMetaFlagValues,
  command: "meta",
): ArchiveMetaPatch | undefined {
  const helpRoute = archiveMaintenanceHelpRoute(command);
  const patch = {
    ...parseArchiveStringMetaPatch(values, "title", "title", helpRoute),
    ...parseArchiveStringMetaPatch(values, "language", "language", helpRoute),
    ...parseArchiveStringMetaPatch(
      values,
      "identifier",
      "identifier",
      helpRoute,
    ),
    ...parseArchiveStringMetaPatch(values, "publisher", "publisher", helpRoute),
    ...parseArchiveStringMetaPatch(
      values,
      "publishedAt",
      "published-at",
      helpRoute,
    ),
    ...parseArchiveStringMetaPatch(
      values,
      "description",
      "description",
      helpRoute,
    ),
    ...parseArchiveAuthorsMetaPatch(values, helpRoute),
  } satisfies ArchiveMetaPatch;

  if (Object.keys(patch).length === 0) {
    return undefined;
  }
  return patch;
}

function parseArchiveStringMetaPatch(
  values: ArchiveMetaFlagValues,
  key:
    | "description"
    | "identifier"
    | "language"
    | "publishedAt"
    | "publisher"
    | "title",
  flag:
    | "description"
    | "identifier"
    | "language"
    | "published-at"
    | "publisher"
    | "title",
  helpRoute: string,
): Partial<ArchiveMetaPatch> {
  const value = values[flag];
  const clearFlag = `clear-${flag}` as keyof ArchiveMetaFlagValues;
  const clearValue = values[clearFlag];

  if (value !== undefined && clearValue === true) {
    throw new Error(
      withHelpRoute(
        `Cannot combine --${flag} with --clear-${flag}.`,
        helpRoute,
      ),
    );
  }
  if (value !== undefined) {
    const normalized = normalizeNonEmptyFlagValue(
      value,
      `--${flag}`,
      helpRoute,
    );

    return {
      [key]: normalized,
    };
  }
  if (clearValue === true) {
    const clearKey = `clear${key[0]!.toUpperCase()}${key.slice(1)}`;

    return {
      [clearKey]: true,
    } as Partial<ArchiveMetaPatch>;
  }

  return {};
}

function parseArchiveAuthorsMetaPatch(
  values: ArchiveMetaFlagValues,
  helpRoute: string,
): Partial<ArchiveMetaPatch> {
  if (values.author !== undefined && values["clear-authors"] === true) {
    throw new Error(
      withHelpRoute("Cannot combine --author with --clear-authors.", helpRoute),
    );
  }
  if (values.author !== undefined) {
    return {
      authors: values.author.map((value) =>
        normalizeNonEmptyFlagValue(value, "--author", helpRoute),
      ),
    };
  }
  if (values["clear-authors"] === true) {
    return {
      clearAuthors: true,
    };
  }

  return {};
}

function normalizeNonEmptyFlagValue(
  value: string,
  flag: string,
  helpRoute: string,
): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error(withHelpRoute(`${flag} cannot be empty.`, helpRoute));
  }

  return normalized;
}

function rejectActionFlag(
  value: string | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectActionBooleanFlag(
  value: boolean | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectConvertFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The main convert command does not support --${name}.`,
        CLI_HELP_ROUTES.command,
      ),
    );
  }
}

function rejectArchiveChapterFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support --${name}.`,
        "spinedigest chapter --help",
      ),
    );
  }
}

function rejectConvertMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The main convert command does not support ${flag}.`,
        CLI_HELP_ROUTES.command,
      ),
    );
  }
}

function rejectArchiveChapterMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values, { includeTitle: false })) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support ${flag}.`,
        "spinedigest chapter --help",
      ),
    );
  }
}

function rejectHelpMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support ${flag}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`config status\` command does not support ${flag}.`,
        "spinedigest config status --help",
      ),
    );
  }
}

function listPresentMetaFlags(
  values: ArchiveMetaFlagValues,
  options: { readonly includeTitle?: boolean } = {},
): readonly string[] {
  const includeTitle = options.includeTitle ?? true;
  const flags: string[] = [];

  if (values.author !== undefined) flags.push("--author");
  if (values["clear-authors"] !== undefined) flags.push("--clear-authors");
  if (values["clear-description"] !== undefined) {
    flags.push("--clear-description");
  }
  if (values["clear-identifier"] !== undefined) {
    flags.push("--clear-identifier");
  }
  if (values["clear-language"] !== undefined) flags.push("--clear-language");
  if (values["clear-published-at"] !== undefined) {
    flags.push("--clear-published-at");
  }
  if (values["clear-publisher"] !== undefined) flags.push("--clear-publisher");
  if (includeTitle && values["clear-title"] !== undefined) {
    flags.push("--clear-title");
  }
  if (values.description !== undefined) flags.push("--description");
  if (values.identifier !== undefined) flags.push("--identifier");
  if (values.language !== undefined) flags.push("--language");
  if (values["published-at"] !== undefined) flags.push("--published-at");
  if (values.publisher !== undefined) flags.push("--publisher");
  if (includeTitle && values.title !== undefined) flags.push("--title");

  return flags;
}

function requireChapterId(
  chapterId: number | undefined,
  action: CLIArchiveChapterAction,
  helpRoute: string,
): asserts chapterId is number {
  if (chapterId === undefined) {
    throw new Error(
      withHelpRoute(
        `Missing --chapter. \`chapter ${action}\` requires a chapter id.`,
        helpRoute,
      ),
    );
  }
}

function rejectHelpFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support --${name}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`config status\` command does not support --${name}.`,
        "spinedigest config status --help",
      ),
    );
  }
}

function isArchiveAction(value: string | undefined): value is CLIArchiveAction {
  return (
    value === "backlinks" ||
    value === "build" ||
    value === "estimate" ||
    value === "evidence" ||
    value === "fragments" ||
    value === "export" ||
    value === "find" ||
    value === "grep" ||
    value === "import" ||
    value === "index" ||
    value === "links" ||
    value === "list" ||
    value === "ls" ||
    value === "map" ||
    value === "page" ||
    value === "pack" ||
    value === "path" ||
    value === "read" ||
    value === "related" ||
    value === "status"
  );
}

function parseArchiveBuildStage(value: string | undefined): ChapterStage {
  if (value === undefined || value === "ready") {
    return "summarized";
  }
  if (value === "source") {
    return "sourced";
  }
  if (value === "graph") {
    return "graphed";
  }
  if (value === "summary") {
    return "summarized";
  }

  return parseChapterStage(value, "--stage", CLI_HELP_ROUTES.command);
}

function parseArchiveEstimateStage(
  value: string | undefined,
): ChapterStage | "ready" | "source" {
  if (value === undefined) {
    return "ready";
  }
  if (value === "ready" || value === "source") {
    return value;
  }
  if (value === "graph") {
    return "graphed";
  }
  if (value === "summary") {
    return "summarized";
  }

  return parseChapterStage(value, "--stage", CLI_HELP_ROUTES.command);
}

function parseArchiveListKind(
  value: string | undefined,
): NonNullable<CLIArchiveArguments["listKind"]> {
  if (value === undefined) {
    return "chapters";
  }
  if (
    value === "chapters" ||
    value === "edges" ||
    value === "evidence" ||
    value === "fragments" ||
    value === "meta" ||
    value === "nodes" ||
    value === "summaries"
  ) {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid list kind: ${value}. Expected chapters, nodes, edges, evidence, fragments, summaries, or meta.`,
      "spinedigest ls --help",
    ),
  );
}

function parseArchiveSearchChapters(value: string): readonly number[] {
  const chapters = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map((item) =>
      parsePositiveIntegerFlag(item, "--chapter", CLI_HELP_ROUTES.command),
    );

  if (chapters.length === 0) {
    throw new Error(
      withHelpRoute("--chapter cannot be empty.", CLI_HELP_ROUTES.command),
    );
  }

  return [...new Set(chapters)];
}

function parseArchiveIds(value: string): readonly string[] {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

  if (ids.length === 0) {
    throw new Error(
      withHelpRoute("--id cannot be empty.", CLI_HELP_ROUTES.command),
    );
  }

  return [...new Set(ids)];
}

function parseArchiveSearchOrder(
  value: string,
): NonNullable<CLIArchiveArguments["searchOrder"]> {
  if (value === "doc-asc" || value === "doc-desc") {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --order: ${value}. Expected doc-asc or doc-desc.`,
      CLI_HELP_ROUTES.command,
    ),
  );
}

function parseArchiveFindMatch(
  value: string,
): NonNullable<CLIArchiveArguments["match"]> {
  if (value === "any" || value === "all") {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --match: ${value}. Expected any or all.`,
      "spinedigest find --help",
    ),
  );
}

function parseArchiveSearchTypes(
  value: string,
): NonNullable<CLIArchiveArguments["searchTypes"]> {
  const types = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map(parseArchiveSearchType);

  if (types.length === 0) {
    throw new Error(
      withHelpRoute("--type cannot be empty.", CLI_HELP_ROUTES.command),
    );
  }

  return [...new Set(types)];
}

function parseArchiveSearchType(
  value: string,
): NonNullable<CLIArchiveArguments["searchTypes"]>[number] {
  if (
    value === "fragment" ||
    value === "node" ||
    value === "sentence" ||
    value === "summary"
  ) {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --type: ${value}. Expected summary, node, fragment, or sentence.`,
      CLI_HELP_ROUTES.command,
    ),
  );
}

function parseArchiveCollectionTypes(
  value: string,
): NonNullable<CLIArchiveArguments["searchTypes"]> {
  const types = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map(parseArchiveCollectionType);

  if (types.length === 0) {
    throw new Error(
      withHelpRoute("--type cannot be empty.", CLI_HELP_ROUTES.command),
    );
  }

  return [...new Set(types)];
}

function parseArchiveCollectionType(
  value: string,
): NonNullable<CLIArchiveArguments["searchTypes"]>[number] {
  if (
    value === "chapter" ||
    value === "fragment" ||
    value === "meta" ||
    value === "node" ||
    value === "sentence" ||
    value === "summary"
  ) {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --type: ${value}. Expected chapter, summary, node, fragment, sentence, or meta.`,
      CLI_HELP_ROUTES.command,
    ),
  );
}

function parseNodeObjectId(value: string, helpRoute: string): number {
  const normalized = value.trim();
  const nodePrefix = "node:";
  const rawId = normalized.startsWith(nodePrefix)
    ? normalized.slice(nodePrefix.length)
    : normalized;
  const parsed = Number(rawId);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      withHelpRoute(`Invalid node id: ${value}. Use node:<id>.`, helpRoute),
    );
  }

  return parsed;
}

function parsePositiveIntegerFlag(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      withHelpRoute(`${flag} must be a positive integer.`, helpRoute),
    );
  }

  return parsed;
}

function normalizeArchiveInlineOptions(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): {
  readonly positionals: readonly string[];
  readonly values: ArchiveArgumentValues;
} {
  const normalizedPositionals: string[] = [];
  const normalizedValues: Record<
    string,
    boolean | readonly string[] | string | undefined
  > = {
    ...values,
  };

  for (let index = 0; index < positionals.length; index += 1) {
    const item = positionals[index];

    if (item === undefined) {
      continue;
    }

    switch (item) {
      case "--json":
      case "--confirm":
        normalizedValues[item.slice(2)] = true;
        continue;
      case "--budget":
      case "--chapter":
      case "--cursor":
      case "--id":
      case "--input":
      case "--input-format":
      case "--limit":
      case "--llm":
      case "--match":
      case "--order":
      case "--output":
      case "--output-format":
      case "--prompt":
      case "--stage":
      case "--type":
      case "--to": {
        const value = positionals[index + 1];

        if (value === undefined) {
          normalizedPositionals.push(item);
          continue;
        }

        normalizedValues[item.slice(2)] = value;
        index += 1;
        continue;
      }
      default:
        normalizedPositionals.push(item);
    }
  }

  return {
    positionals: normalizedPositionals,
    values: normalizedValues,
  };
}

function rejectArchiveExtraPositionals(
  action: CLIArchiveAction,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${action}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveMaintenanceExtraPositionals(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${command}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

function rejectMetaCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectMetaCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support ${flag}.`,
        "spinedigest cover --help",
      ),
    );
  }
}

function rejectArchiveFlag(
  action: CLIArchiveAction,
  flag: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveBooleanFlag(
  action: CLIArchiveAction,
  flag: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveNonReadFlags(
  action: CLIArchiveAction,
  values: {
    readonly input?: string;
    readonly "input-format"?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
  },
  helpRoute: string,
): void {
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(
    action,
    "--input-format",
    values["input-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
  rejectArchiveFlag(action, "--output", values.output, helpRoute);
  rejectArchiveFlag(
    action,
    "--output-format",
    values["output-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
}

function rejectArchiveReadFlags(
  action: CLIArchiveAction,
  values: {
    readonly json?: boolean;
  },
  helpRoute: string,
): void {
  rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
}
