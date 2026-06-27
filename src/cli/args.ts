import { parseArgs } from "util";

import { type CLIFormat, parseCLIFormat } from "./formats.js";
import {
  CLI_HELP_ROUTES,
  archiveMaintenanceHelpRoute,
  withHelpRoute,
} from "./errors.js";
import { type BuildJobTarget, type ChapterStage } from "../facade/index.js";
import {
  parseHelpTopic,
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpTopicText,
  renderMainHelpText,
  renderQueueCommandHelpText,
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
  | "list"
  | "move"
  | "remove"
  | "reset"
  | "set-source"
  | "set-summary"
  | "set-title"
  | "status"
  | "tree";

export interface CLIArchiveChapterArguments {
  readonly action: CLIArchiveChapterAction;
  readonly addStage?: Extract<ChapterStage, "planned" | "sourced">;
  readonly afterChapterId?: number;
  readonly beforeChapterId?: number;
  readonly chapterId?: number;
  readonly clearTitle?: boolean;
  readonly dryRun?: boolean;
  readonly first?: boolean;
  readonly inputFormat?: Extract<CLIFormat, "markdown" | "txt">;
  readonly inputPath?: string;
  readonly json?: boolean;
  readonly last?: boolean;
  readonly llmJSON?: string;
  readonly moveToRoot?: boolean;
  readonly parentChapterId?: number;
  readonly path: string;
  readonly prompt?: string;
  readonly recursive?: boolean;
  readonly resetStage?: Exclude<ChapterStage, "summarized">;
  readonly title?: string;
  readonly treeAction?: "apply" | "show";
}

export interface CLIStatusArguments {
  readonly llmJSON?: string;
}

export type CLIQueueAction =
  | "add"
  | "boost"
  | "cancel"
  | "clean"
  | "list"
  | "pause"
  | "resume"
  | "status"
  | "target"
  | "watch"
  | "worker";

export type CLIObjectKind =
  | "chunk"
  | "entity"
  | "source"
  | "summary"
  | "triple";
export type CLIResultFormat = "json" | "jsonl" | "text";

export interface CLIQueueArguments {
  readonly action: CLIQueueAction;
  readonly acceptCost?: boolean;
  readonly activeOnly?: boolean;
  readonly all?: boolean;
  readonly archivePath?: string;
  readonly boost?: boolean;
  readonly chapterId?: number;
  readonly from?: "beginning" | "now";
  readonly jobId?: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly llmJSON?: string;
  readonly prompt?: string;
  readonly target?: BuildJobTarget;
}

export type CLIArchiveAction =
  | "create"
  | "evidence"
  | "estimate"
  | "export"
  | "get"
  | "index"
  | "pack"
  | "related"
  | "search";

export type CLIArchiveMaintenanceCommand = "chapter" | "cover" | "meta";

export interface CLIArchiveArguments {
  readonly action: CLIArchiveAction;
  readonly archivePath: string;
  readonly budget?: number;
  readonly chapters?: readonly number[];
  readonly chapterId?: number;
  readonly confirm?: boolean;
  readonly cursor?: string;
  readonly format?: CLIResultFormat;
  readonly inputFormat?: CLIFormat;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly kinds?: readonly CLIObjectKind[];
  readonly limit?: number;
  readonly llmJSON?: string;
  readonly objectId?: string;
  readonly outputFormat?: CLIFormat;
  readonly outputPath?: string;
  readonly prompt?: string;
  readonly predicate?: string;
  readonly query?: string;
  readonly sourcePath?: string;
  readonly targetStage?: ChapterStage;
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
  readonly "accept-cost"?: boolean;
  readonly active?: boolean;
  readonly after?: string;
  readonly all?: boolean;
  readonly before?: string;
  readonly boost?: boolean;
  readonly budget?: string;
  readonly chapter?: string;
  readonly clear?: boolean;
  readonly confirm?: boolean;
  readonly cursor?: string;
  readonly "digest-dir"?: string;
  readonly "dry-run"?: boolean;
  readonly first?: boolean;
  readonly fragment?: string;
  readonly from?: string;
  readonly help?: boolean;
  readonly input?: string;
  readonly "input-format"?: string;
  readonly id?: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly limit?: string;
  readonly llm?: string;
  readonly match?: string;
  readonly meta?: string;
  readonly output?: string;
  readonly "output-format"?: string;
  readonly order?: string;
  readonly parent?: string;
  readonly predicate?: string;
  readonly prompt?: string;
  readonly root?: boolean;
  readonly stage?: string;
  readonly last?: boolean;
  readonly node?: string;
  readonly summary?: string;
  readonly task?: string;
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
      readonly args: CLIQueueArguments;
      readonly help: false;
      readonly kind: "queue";
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
      after: {
        type: "string",
      },
      before: {
        type: "string",
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
      fragment: {
        type: "string",
      },
      from: {
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
      jsonl: {
        type: "boolean",
      },
      llm: {
        type: "string",
      },
      match: {
        type: "string",
      },
      meta: {
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
      predicate: {
        type: "string",
      },
      stage: {
        type: "string",
      },
      node: {
        type: "string",
      },
      summary: {
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
      root: {
        type: "boolean",
      },
      last: {
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

  if (values.help === true && positionals.length === 0) {
    return {
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    };
  }

  if (
    values["accept-cost"] === true &&
    !(positionals[0] === "queue" && positionals[1] === "add")
  ) {
    throw new Error(
      withHelpRoute(
        "`--accept-cost` is only valid for `wikigraph queue add`.",
        "wikigraph queue --help",
      ),
    );
  }

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "config") {
    return parseConfigArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "queue") {
    return parseQueueArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "transform") {
    return parseTransformArguments(positionals.slice(1), values);
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

  throw new Error(
    withHelpRoute(
      positionals.length === 0
        ? "Missing command."
        : `Unknown command: ${positionals[0]}.`,
      CLI_HELP_ROUTES.command,
    ),
  );
}

function parseTransformArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wikigraph transform --help";

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
  rejectTransformFlag("id", values.id, helpRoute);
  rejectTransformFlag("json", values.json, helpRoute);
  rejectTransformFlag("limit", values.limit, helpRoute);
  rejectTransformFlag("match", values.match, helpRoute);
  rejectTransformFlag("order", values.order, helpRoute);
  rejectTransformFlag("parent", values.parent, helpRoute);
  rejectTransformFlag("to", values.to, helpRoute);
  rejectTransformFlag("type", values.type, helpRoute);

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
        "wikigraph config status --help",
      ),
    );
  }

  return parseConfigStatusArguments(positionals.slice(1), values);
}

function parseQueueArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const action = positionals[0];
  const helpRoute = "wikigraph queue --help";

  if (values.help === true) {
    if (isQueueAction(action)) {
      return {
        help: true,
        helpText: renderQueueCommandHelpText(action),
        kind: "help",
      };
    }
    return {
      help: true,
      helpText: renderQueueCommandHelpText(),
      kind: "help",
    };
  }
  if (!isQueueAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing queue action."
          : `Invalid queue action: ${action}. Expected add, list, status, watch, pause, resume, cancel, boost, target, clean, or worker.`,
        helpRoute,
      ),
    );
  }
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The `queue` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  switch (action) {
    case "add": {
      rejectQueueJSONFlag(action, values.json, helpRoute);
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueFlag(action, "--stage", values.stage, helpRoute);
      rejectQueueFlag(action, "--to", values.to, helpRoute);
      const archivePath = positionals[1];

      if (archivePath === undefined || archivePath === "-") {
        throw new Error(
          withHelpRoute(
            "`wikigraph queue add` requires <archive.sdpub>.",
            helpRoute,
          ),
        );
      }
      rejectQueueExtraPositionals(action, positionals, 2, helpRoute);
      const chapterId =
        values.chapter === undefined
          ? undefined
          : parseSerialId(values.chapter, "--chapter", helpRoute);

      if (chapterId === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph queue add` requires --chapter <id>.",
            helpRoute,
          ),
        );
      }
      return {
        args: {
          action,
          ...(values["accept-cost"] === undefined
            ? {}
            : { acceptCost: values["accept-cost"] }),
          archivePath,
          ...(values.boost === undefined ? {} : { boost: values.boost }),
          chapterId,
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
          target: parseBuildJobTarget(values.task),
        },
        help: false,
        kind: "queue",
      };
    }
    case "list":
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueExtraPositionals(action, positionals, 1, helpRoute);
      return {
        args: {
          action,
          ...(values.active === undefined ? {} : { activeOnly: values.active }),
          ...(values.all === undefined ? {} : { all: values.all }),
          ...(values.input === undefined ? {} : { archivePath: values.input }),
          ...(values.json === undefined ? {} : { json: values.json }),
        },
        help: false,
        kind: "queue",
      };
    case "status": {
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      const jobId = positionals[1];

      if (jobId === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph queue status` requires <job-id>.",
            helpRoute,
          ),
        );
      }
      rejectQueueExtraPositionals(action, positionals, 2, helpRoute);

      return {
        args: {
          action,
          jobId,
          ...(values.json === undefined ? {} : { json: values.json }),
        },
        help: false,
        kind: "queue",
      };
    }
    case "watch": {
      rejectQueueJSONFlag(action, values.json, helpRoute);
      const jobId = positionals[1];

      if (jobId === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph queue watch` requires <job-id>.",
            helpRoute,
          ),
        );
      }
      rejectQueueExtraPositionals(action, positionals, 2, helpRoute);
      const watchFrom = parseWatchFrom(values.from, helpRoute);

      return {
        args: {
          action,
          jobId,
          ...(watchFrom === undefined ? {} : { from: watchFrom }),
          ...(values.jsonl === undefined ? {} : { jsonl: values.jsonl }),
        },
        help: false,
        kind: "queue",
      };
    }
    case "pause":
    case "resume":
    case "cancel":
    case "boost": {
      rejectQueueJSONFlag(action, values.json, helpRoute);
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      const jobId = positionals[1];

      if (jobId === undefined) {
        throw new Error(
          withHelpRoute(
            `\`wikigraph queue ${action}\` requires <job-id>.`,
            helpRoute,
          ),
        );
      }
      rejectQueueExtraPositionals(action, positionals, 2, helpRoute);

      return {
        args: {
          action,
          jobId,
        },
        help: false,
        kind: "queue",
      };
    }
    case "target": {
      rejectQueueJSONFlag(action, values.json, helpRoute);
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueFlag(action, "--stage", values.stage, helpRoute);
      rejectQueueFlag(action, "--to", values.to, helpRoute);
      const jobId = positionals[1];

      if (jobId === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph queue target` requires <job-id>.",
            helpRoute,
          ),
        );
      }
      rejectQueueExtraPositionals(action, positionals, 2, helpRoute);
      return {
        args: {
          action,
          jobId,
          target: parseBuildJobTarget(values.task),
        },
        help: false,
        kind: "queue",
      };
    }
    case "clean":
    case "worker":
      rejectQueueJSONFlag(action, values.json, helpRoute);
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueExtraPositionals(action, positionals, 1, helpRoute);
      return {
        args: {
          action,
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        },
        help: false,
        kind: "queue",
      };
  }
}

function rejectQueueJSONFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support --json.`,
      helpRoute,
    ),
  );
}

function rejectQueueJSONLFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support --jsonl.`,
      helpRoute,
    ),
  );
}

function rejectQueueFlag(
  action: CLIQueueAction,
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value === undefined) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support ${name}.`,
      helpRoute,
    ),
  );
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
  const helpRoute = "wikigraph meta --help";

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
        "Missing archive path. Use `wikigraph meta <archive.sdpub>`.",
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
  const helpRoute = "wikigraph cover --help";

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
        "Missing archive path. Use `wikigraph cover <archive.sdpub>`.",
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
  const helpRoute = `wikigraph ${action} --help`;

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
        `Missing archive path. Use \`wikigraph ${action} <archive.sdpub>\`.`,
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
    case "create": {
      const rawSourcePath = positionals[1] ?? values.input;
      const sourcePath = rawSourcePath === "-" ? undefined : rawSourcePath;
      const inputFormat =
        values["input-format"] === undefined
          ? undefined
          : parseCLIFormat(values["input-format"], "--input-format");

      if (sourcePath === undefined && inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph create` requires a source path, or --input-format when reading source text from stdin.",
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
            "stdin create only supports --input-format markdown or txt.",
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
      rejectArchiveSelectorFlags(action, values, helpRoute);
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
      rejectArchiveSelectorFlags(action, values, helpRoute);
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
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
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
    case "index":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
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
    case "search": {
      const query = positionals[1];

      if (query === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph search` requires a search query.",
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--id", values.id, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveFlag(action, "--match", values.match, helpRoute);
      rejectArchiveFlag(action, "--order", values.order, helpRoute);

      return {
        args: {
          action,
          archivePath,
          ...(values.chapter === undefined
            ? {}
            : { chapters: parseArchiveSearchChapters(values.chapter) }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          format: parseResultFormat(values),
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
          ...(values.type === undefined
            ? {}
            : { kinds: parseObjectKinds(values.type) }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "get": {
      const uri = positionals[1];

      if (uri === undefined) {
        throw new Error(
          withHelpRoute("`wikigraph get` requires <uri>.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--id", values.id, helpRoute);
      rejectArchiveFlag(action, "--type", values.type, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--order", values.order, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          format: parseResultFormat(values),
          objectId: uri,
        },
        help: false,
        kind: "archive",
      };
    }
    case "related": {
      const uri = positionals[1];

      if (uri === undefined) {
        throw new Error(
          withHelpRoute(`\`wikigraph ${action}\` requires <uri>.`, helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--id", values.id, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--order", values.order, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--predicate", values.predicate, helpRoute);
      rejectArchiveFlag(action, "--type", values.type, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          format: parseResultFormat(values),
          objectId: uri,
        },
        help: false,
        kind: "archive",
      };
    }
    case "evidence": {
      const uri = positionals[1];

      if (uri === undefined) {
        throw new Error(
          withHelpRoute(`\`wikigraph ${action}\` requires <uri>.`, helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--id", values.id, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--order", values.order, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--predicate", values.predicate, helpRoute);
      rejectArchiveFlag(action, "--type", values.type, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          objectId: uri,
        },
        help: false,
        kind: "archive",
      };
    }
    case "pack": {
      const uri = positionals[1];

      if (uri === undefined) {
        throw new Error(
          withHelpRoute("`wikigraph pack` requires <uri>.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--id", values.id, helpRoute);
      rejectArchiveFlag(action, "--type", values.type, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--order", values.order, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveSelectorFlags(action, values, helpRoute);
      return {
        args: {
          action,
          archivePath,
          budget:
            values.budget === undefined
              ? 5000
              : parsePositiveIntegerFlag(values.budget, "--budget", helpRoute),
          format: parseResultFormat(values),
          objectId: uri,
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
    readonly after?: string;
    readonly author?: readonly string[];
    readonly before?: string;
    readonly chapter?: string;
    readonly clear?: boolean;
    readonly "clear-authors"?: boolean;
    readonly "clear-description"?: boolean;
    readonly "clear-identifier"?: boolean;
    readonly "clear-language"?: boolean;
    readonly "clear-published-at"?: boolean;
    readonly "clear-publisher"?: boolean;
    readonly "clear-title"?: boolean;
    readonly description?: string;
    readonly "digest-dir"?: string;
    readonly "dry-run"?: boolean;
    readonly first?: boolean;
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
    readonly root?: boolean;
    readonly last?: boolean;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const action = positionals[0];
  const treeAction =
    action === "tree" && positionals[1] === "apply" ? "apply" : undefined;
  const path = treeAction === "apply" ? positionals[2] : positionals[1];
  const helpRoute = "wikigraph chapter --help";

  rejectArchiveChapterFlag("digest-dir", values["digest-dir"]);
  rejectArchiveChapterFlag("limit", values.limit);
  rejectArchiveChapterFlag("output", values.output);
  rejectArchiveChapterFlag("output-format", values["output-format"]);
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
          : `Invalid chapter action: ${action}. Expected one of list, status, add, move, remove, reset, set-source, set-summary, set-title, tree.`,
        helpRoute,
      ),
    );
  }
  if (path === undefined || path === "-") {
    throw new Error(
      withHelpRoute(
        "`wikigraph chapter` requires a .sdpub path positional argument.",
        helpRoute,
      ),
    );
  }
  const maxPositionals =
    action === "tree" && positionals[1] === "apply" ? 3 : 2;
  if (positionals.length > maxPositionals) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.slice(maxPositionals).join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: normalizeArchiveChapterArguments(
      action,
      path,
      values,
      helpRoute,
      treeAction,
    ),
    help: false,
    kind: "chapter",
  };
}

function normalizeArchiveChapterArguments(
  action: CLIArchiveChapterAction,
  path: string,
  values: {
    readonly chapter?: string;
    readonly after?: string;
    readonly before?: string;
    readonly clear?: boolean;
    readonly "dry-run"?: boolean;
    readonly first?: boolean;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly llm?: string;
    readonly parent?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly root?: boolean;
    readonly last?: boolean;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
  },
  helpRoute: string,
  treeAction?: "apply",
): CLIArchiveChapterArguments {
  const chapterId =
    values.chapter === undefined
      ? undefined
      : parseSerialId(values.chapter, "--chapter", helpRoute);
  const parentChapterId =
    values.parent === undefined
      ? undefined
      : parseSerialId(values.parent, "--parent", helpRoute);
  const beforeChapterId =
    values.before === undefined
      ? undefined
      : parseSerialId(values.before, "--before", helpRoute);
  const afterChapterId =
    values.after === undefined
      ? undefined
      : parseSerialId(values.after, "--after", helpRoute);
  const inputFormat =
    values["input-format"] === undefined
      ? undefined
      : parseChapterInputFormat(values["input-format"], helpRoute);
  const addStage =
    values.stage === undefined
      ? undefined
      : parseChapterAddStage(values.stage, helpRoute);
  const resetStage =
    values.to === undefined ? undefined : parseResetStage(values.to, helpRoute);

  switch (action) {
    case "add":
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      if (addStage === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --stage. `chapter add` requires planned or source.",
            helpRoute,
          ),
        );
      }
      if (addStage === "planned") {
        rejectActionFlag(values.input, "--input", action, helpRoute);
        rejectActionFlag(
          values["input-format"],
          "--input-format",
          action,
          helpRoute,
        );
      } else if (addStage === "sourced" && inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --input-format. `chapter add --stage source` requires txt or markdown.",
            helpRoute,
          ),
        );
      }
      return {
        action,
        path,
        ...(addStage === undefined ? {} : { addStage }),
        ...(inputFormat === undefined ? {} : { inputFormat }),
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        ...(values.title === undefined ? {} : { title: values.title }),
      };
    case "list":
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
    case "move":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      rejectConflictingMoveFlags(values, helpRoute);
      return {
        action,
        ...(afterChapterId === undefined ? {} : { afterChapterId }),
        ...(beforeChapterId === undefined ? {} : { beforeChapterId }),
        chapterId,
        ...(values.first === undefined ? {} : { first: values.first }),
        ...(values.last === undefined ? {} : { last: values.last }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(values.root === undefined ? {} : { moveToRoot: values.root }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        path,
      };
    case "remove":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      if (resetStage === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --to. `chapter reset` requires planned, source, or reading-graph.",
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
    case "set-title":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      if (values.title === undefined && values.clear !== true) {
        throw new Error(
          withHelpRoute(
            "Missing --title or --clear. `chapter set-title` requires a title value or --clear.",
            helpRoute,
          ),
        );
      }
      if (values.title !== undefined && values.clear === true) {
        throw new Error(
          withHelpRoute(
            "`chapter set-title` cannot combine --title with --clear.",
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
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        ...(values.clear === undefined ? {} : { clearTitle: values.clear }),
        path,
        ...(values.title === undefined ? {} : { title: values.title }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "status":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
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
    case "tree":
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
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
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      if (treeAction === "apply" && values.json === true) {
        throw new Error(
          withHelpRoute(
            "`chapter tree apply` does not support --json.",
            helpRoute,
          ),
        );
      }
      if (treeAction === "apply") {
        return {
          action,
          ...(values["dry-run"] === undefined
            ? {}
            : { dryRun: values["dry-run"] }),
          ...(values.input === undefined ? {} : { inputPath: values.input }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          path,
          treeAction: "apply",
        };
      }
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      return {
        action,
        json: values.json ?? false,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        path,
        treeAction: "show",
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
        "wikigraph config status --help",
      ),
    );
  }

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        "wikigraph config status --help",
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
    value === "list" ||
    value === "move" ||
    value === "remove" ||
    value === "reset" ||
    value === "set-source" ||
    value === "set-summary" ||
    value === "set-title" ||
    value === "status" ||
    value === "tree"
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
  const stage = parseExternalChapterStage(value);

  if (stage !== undefined) {
    return stage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid ${flag}: ${value}. Expected planned, source, reading-graph, or reading-summary.`,
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

function parseChapterAddStage(
  value: string,
  helpRoute: string,
): Extract<ChapterStage, "planned" | "sourced"> {
  const stage = parseExternalChapterStage(value);

  if (stage === "planned" || stage === "sourced") {
    return stage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --stage: ${value}. chapter add accepts planned or source.`,
      helpRoute,
    ),
  );
}

function parseResetStage(
  value: string,
  helpRoute: string,
): Exclude<ChapterStage, "summarized"> {
  const stage = parseExternalChapterStage(value);

  if (stage === "planned" || stage === "sourced" || stage === "graphed") {
    return stage;
  }
  if (stage !== undefined) {
    throw new Error(
      withHelpRoute(
        "`chapter reset` does not support --to reading-summary.",
        helpRoute,
      ),
    );
  }

  throw new Error(
    withHelpRoute(
      `Invalid --to: ${value}. Expected planned, source, or reading-graph.`,
      helpRoute,
    ),
  );
}

function parseExternalChapterStage(value: string): ChapterStage | undefined {
  switch (value.trim().toLowerCase()) {
    case "planned":
      return "planned";
    case "source":
      return "sourced";
    case "reading-graph":
      return "graphed";
    case "reading-summary":
      return "summarized";
    default:
      return undefined;
  }
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

function rejectConflictingMoveFlags(
  values: {
    readonly after?: string;
    readonly before?: string;
    readonly first?: boolean;
    readonly last?: boolean;
    readonly parent?: string;
    readonly root?: boolean;
  },
  helpRoute: string,
): void {
  const parentTargets = [
    values.parent === undefined ? undefined : "--parent",
    values.root === undefined ? undefined : "--root",
  ].filter((flag): flag is string => flag !== undefined);
  const positionTargets = [
    values.before === undefined ? undefined : "--before",
    values.after === undefined ? undefined : "--after",
    values.first === undefined ? undefined : "--first",
    values.last === undefined ? undefined : "--last",
  ].filter((flag): flag is string => flag !== undefined);

  if (parentTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one parent target: ${parentTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (positionTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one position target: ${positionTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (
    parentTargets.length > 0 &&
    (values.before !== undefined || values.after !== undefined)
  ) {
    throw new Error(
      withHelpRoute(
        "Do not combine --parent or --root with --before or --after.",
        helpRoute,
      ),
    );
  }
  if (parentTargets.length === 0 && positionTargets.length === 0) {
    throw new Error(
      withHelpRoute(
        "`chapter move` requires --parent, --root, --before, --after, --first, or --last.",
        helpRoute,
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
        "wikigraph chapter --help",
      ),
    );
  }
}

function rejectArchiveChapterMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values, { includeTitle: false })) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support ${flag}.`,
        "wikigraph chapter --help",
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
        "wikigraph config status --help",
      ),
    );
  }
}

function rejectTransformFlag(
  name: string,
  value: boolean | string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectTransformMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support ${flag}.`,
        "wikigraph transform --help",
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
        "wikigraph config status --help",
      ),
    );
  }
}

function isArchiveAction(value: string | undefined): value is CLIArchiveAction {
  return (
    value === "create" ||
    value === "evidence" ||
    value === "estimate" ||
    value === "export" ||
    value === "get" ||
    value === "index" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

function isQueueAction(value: string | undefined): value is CLIQueueAction {
  return (
    value === "add" ||
    value === "boost" ||
    value === "cancel" ||
    value === "clean" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "status" ||
    value === "target" ||
    value === "watch" ||
    value === "worker"
  );
}

function parseBuildJobTarget(value: string | undefined): BuildJobTarget {
  switch (value) {
    case undefined:
    case "reading-summary":
      return "reading-summary";
    case "reading-graph":
      return "reading-graph";
    case "knowledge-graph":
      return "knowledge-graph";
    default:
      throw new Error(
        withHelpRoute(
          `Invalid queue task: ${value}. Expected reading-graph, reading-summary, or knowledge-graph.`,
          "wikigraph queue --help",
        ),
      );
  }
}

function parseWatchFrom(
  value: string | undefined,
  helpRoute: string,
): "beginning" | "now" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "beginning" || value === "now") {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --from: ${value}. Expected beginning or now.`,
      helpRoute,
    ),
  );
}

function parseArchiveEstimateStage(value: string | undefined): ChapterStage {
  if (value === undefined) {
    return "summarized";
  }

  return parseChapterStage(value, "--stage", CLI_HELP_ROUTES.command);
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

function parseObjectKinds(value: string): readonly CLIObjectKind[] {
  const kinds = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map(parseObjectKind);

  if (kinds.length === 0) {
    throw new Error(
      withHelpRoute("--type cannot be empty.", CLI_HELP_ROUTES.command),
    );
  }

  return [...new Set(kinds)];
}

function parseObjectKind(value: string): CLIObjectKind {
  if (
    value === "chunk" ||
    value === "entity" ||
    value === "source" ||
    value === "summary" ||
    value === "triple"
  ) {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --type: ${value}. Expected entity, triple, source, summary, or chunk.`,
      CLI_HELP_ROUTES.command,
    ),
  );
}

function parseResultFormat(values: {
  readonly json?: boolean;
  readonly jsonl?: boolean;
}): CLIResultFormat {
  if (values.json === true && values.jsonl === true) {
    throw new Error(
      withHelpRoute(
        "`--json` and `--jsonl` cannot be combined.",
        CLI_HELP_ROUTES.command,
      ),
    );
  }

  if (values.json === true) {
    return "json";
  }
  if (values.jsonl === true) {
    return "jsonl";
  }

  return "text";
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
      case "--meta":
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

function rejectQueueExtraPositionals(
  action: CLIQueueAction,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`queue ${action}\`: ${positionals.slice(allowed).join(" ")}.`,
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
        "wikigraph cover --help",
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

function rejectArchiveSelectorFlags(
  action: CLIArchiveAction,
  values: {
    readonly fragment?: string;
    readonly from?: string;
    readonly meta?: string;
    readonly node?: string;
    readonly summary?: string;
  },
  helpRoute: string,
): void {
  rejectArchiveFlag(action, "--fragment", values.fragment, helpRoute);
  rejectArchiveFlag(action, "--from", values.from, helpRoute);
  rejectArchiveFlag(action, "--meta", values.meta, helpRoute);
  rejectArchiveFlag(action, "--node", values.node, helpRoute);
  rejectArchiveFlag(action, "--summary", values.summary, helpRoute);
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
