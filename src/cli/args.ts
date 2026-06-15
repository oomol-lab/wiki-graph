import { parseArgs } from "util";

import { type CLIFormat, parseCLIFormat } from "./formats.js";
import {
  CLI_HELP_ROUTES,
  sdpubSubcommandHelpRoute,
  withHelpRoute,
} from "./errors.js";
import { CHAPTER_STAGES, type ChapterStage } from "../facade/index.js";
import {
  parseHelpTopic,
  renderHelpTopicText,
  renderMainHelpText,
  renderStatusHelpText,
  renderSdpubHelpText,
  renderSdpubSubcommandHelpText,
  SDPUB_SUBCOMMANDS,
  type SDPubSubcommand,
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

export interface CLISdpubArguments {
  readonly inputPath: string;
  readonly llmJSON?: string;
  readonly metaPatch?: SdpubMetaPatch;
  readonly serialId?: number;
  readonly subcommand: Exclude<SDPubSubcommand, "chapter">;
}

export interface SdpubMetaPatch {
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

export type CLISdpubChapterAction =
  | "add"
  | "generate-graph"
  | "generate-summary"
  | "list"
  | "remove"
  | "reset"
  | "set-source"
  | "set-summary"
  | "status";

export interface CLISdpubChapterArguments {
  readonly action: CLISdpubChapterAction;
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

export type CLISdpubStageAction = "advance" | "pending";

export interface CLISdpubStageArguments {
  readonly action: CLISdpubStageAction;
  readonly chapterId?: number;
  readonly llmJSON?: string;
  readonly path: string;
  readonly prompt?: string;
  readonly targetStage?: ChapterStage;
}

interface SdpubMetaFlagValues {
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

export type ParsedCLIArguments =
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
      readonly args: CLISdpubArguments;
      readonly help: false;
      readonly kind: "sdpub";
    }
  | {
      readonly args?: CLISdpubArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "sdpub";
    }
  | {
      readonly args: CLISdpubChapterArguments;
      readonly help: false;
      readonly kind: "sdpub-chapter";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "sdpub-chapter";
    }
  | {
      readonly args: CLISdpubStageArguments;
      readonly help: false;
      readonly kind: "sdpub-stage";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "sdpub-stage";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "help";
    }
  | {
      readonly args: CLIStatusArguments;
      readonly help: false;
      readonly kind: "status";
    }
  | {
      readonly args: CLIStatusArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "status";
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
      input: {
        type: "string",
      },
      "input-format": {
        type: "string",
      },
      language: {
        type: "string",
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
      serial: {
        type: "string",
      },
      stage: {
        type: "string",
      },
      chapter: {
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
      to: {
        type: "string",
      },
      verbose: {
        short: "v",
        type: "boolean",
      },
    },
    strict: true,
  });

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "sdpub") {
    return parseSdpubArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "status") {
    return parseStatusArguments(positionals.slice(1), values);
  }

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}. Use --input and --output instead.`,
        CLI_HELP_ROUTES.command,
      ),
    );
  }

  rejectConvertMetaFlags(values);

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
      helpText: renderMainHelpText(),
      kind: "convert",
    };
  }

  return {
    args,
    help: false,
    kind: "convert",
  };
}

function parseSdpubArguments(
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
    readonly language?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly parent?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly serial?: string;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const subcommand = positionals[0];
  const isKnownSubcommand =
    subcommand !== undefined &&
    SDPUB_SUBCOMMANDS.includes(subcommand as SDPubSubcommand);

  if (subcommand === "chapter") {
    return parseSdpubChapterArguments(positionals.slice(1), values);
  }
  if (subcommand === "stage") {
    return parseSdpubStageArguments(positionals.slice(1), values);
  }

  if (positionals.length > 1) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
        isKnownSubcommand
          ? sdpubSubcommandHelpRoute(subcommand)
          : CLI_HELP_ROUTES.sdpub,
      ),
    );
  }

  if (subcommand === undefined) {
    if (help) {
      return {
        help: true,
        helpText: renderSdpubHelpText(),
        kind: "sdpub",
      };
    }

    throw new Error(
      withHelpRoute(
        `Missing sdpub subcommand. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }

  if (!SDPUB_SUBCOMMANDS.includes(subcommand as SDPubSubcommand)) {
    throw new Error(
      withHelpRoute(
        `Invalid sdpub subcommand: ${subcommand}. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }

  const parsedSubcommand = subcommand as Exclude<SDPubSubcommand, "chapter">;

  if (values["digest-dir"] !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --digest-dir. Use the main command for digest generation.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  if (values["input-format"] !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --input-format. They always read .sdpub archives.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  if (values.output !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  if (values["output-format"] !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --output-format. Their output format is fixed by the subcommand.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  if (values.prompt !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --prompt. It only applies to digest generation from source inputs.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  if (values.stage !== undefined) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --stage. Use the main command when creating .sdpub output.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }
  const metaPatch = parseSdpubMetaPatch(values, parsedSubcommand);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `sdpub` subcommands do not support --verbose.",
        CLI_HELP_ROUTES.sdpub,
      ),
    );
  }

  const serialId =
    values.serial === undefined
      ? undefined
      : parseSerialId(
          values.serial,
          "--serial",
          sdpubSubcommandHelpRoute(parsedSubcommand),
        );

  if (parsedSubcommand === "cat" && serialId === undefined && !help) {
    throw new Error(
      withHelpRoute(
        "Missing --serial. `spinedigest sdpub cat` requires it.",
        sdpubSubcommandHelpRoute("cat"),
      ),
    );
  }
  if (parsedSubcommand !== "cat" && serialId !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub ${parsedSubcommand}\` subcommand does not support --serial.`,
        sdpubSubcommandHelpRoute(parsedSubcommand),
      ),
    );
  }

  const inputPath = values.input;

  if (!help) {
    if (inputPath === undefined || inputPath === "-") {
      throw new Error(
        withHelpRoute(
          "The `sdpub` subcommands require --input <path>. stdin is not supported.",
          sdpubSubcommandHelpRoute(parsedSubcommand),
        ),
      );
    }
    if (parseCLIFormat("sdpub", "--input-format") !== "sdpub") {
      throw new Error("Internal error: failed to resolve sdpub input format.");
    }
  }

  if (help) {
    return {
      help: true,
      helpText: renderSdpubSubcommandHelpText(parsedSubcommand),
      kind: "sdpub",
    };
  }

  return {
    args: {
      inputPath: inputPath!,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      ...(metaPatch === undefined ? {} : { metaPatch }),
      ...(serialId === undefined ? {} : { serialId }),
      subcommand: parsedSubcommand,
    },
    help: false,
    kind: "sdpub",
  };
}

function parseSdpubChapterArguments(
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
    readonly language?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly parent?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly serial?: string;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const action = positionals[0];
  const path = positionals[1];
  const helpRoute = "spinedigest sdpub chapter --help";

  rejectSdpubChapterFlag("digest-dir", values["digest-dir"]);
  rejectSdpubChapterFlag("output", values.output);
  rejectSdpubChapterFlag("output-format", values["output-format"]);
  rejectSdpubChapterFlag("serial", values.serial);
  rejectSdpubChapterFlag("stage", values.stage);
  rejectSdpubChapterMetaFlags(values);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `sdpub chapter` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  if (help) {
    return {
      help: true,
      helpText: renderSdpubSubcommandHelpText("chapter"),
      kind: "sdpub-chapter",
    };
  }

  if (!isSdpubChapterAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing sdpub chapter action."
          : `Invalid sdpub chapter action: ${action}.`,
        helpRoute,
      ),
    );
  }
  if (path === undefined || path === "-") {
    throw new Error(
      withHelpRoute(
        "`spinedigest sdpub chapter` requires a .sdpub path positional argument.",
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
    args: normalizeSdpubChapterArguments(action, path, values, helpRoute),
    help: false,
    kind: "sdpub-chapter",
  };
}

function parseSdpubStageArguments(
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
    readonly language?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly parent?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly serial?: string;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const action = positionals[0];
  const path = positionals[1];
  const helpRoute = "spinedigest sdpub stage --help";

  rejectSdpubStageFlag("digest-dir", values["digest-dir"]);
  rejectSdpubStageFlag("input", values.input);
  rejectSdpubStageFlag("input-format", values["input-format"]);
  rejectSdpubStageFlag("output", values.output);
  rejectSdpubStageFlag("output-format", values["output-format"]);
  rejectSdpubStageFlag("parent", values.parent);
  rejectSdpubStageFlag("recursive", values.recursive);
  rejectSdpubStageFlag("serial", values.serial);
  rejectSdpubStageFlag("stage", values.stage);
  rejectSdpubStageFlag("title", values.title);
  rejectSdpubStageMetaFlags(values);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `sdpub stage` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  if (help) {
    return {
      help: true,
      helpText: renderSdpubSubcommandHelpText("stage"),
      kind: "sdpub-stage",
    };
  }

  if (!isSdpubStageAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing sdpub stage action."
          : `Invalid sdpub stage action: ${action}.`,
        helpRoute,
      ),
    );
  }
  if (path === undefined || path === "-") {
    throw new Error(
      withHelpRoute(
        "`spinedigest sdpub stage` requires a .sdpub path positional argument.",
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

  const chapterId =
    values.chapter === undefined
      ? undefined
      : parseSerialId(values.chapter, "--chapter", helpRoute);
  const targetStage =
    values.to === undefined
      ? undefined
      : parseChapterStage(values.to, "--to", helpRoute);

  switch (action) {
    case "advance":
      return {
        args: {
          action,
          ...(chapterId === undefined ? {} : { chapterId }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          path,
          ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
          ...(targetStage === undefined ? {} : { targetStage }),
        },
        help: false,
        kind: "sdpub-stage",
      };
    case "pending":
      rejectSdpubStageActionFlag(values.chapter, "--chapter", action);
      rejectSdpubStageActionFlag(values.prompt, "--prompt", action);
      rejectSdpubStageActionFlag(values.to, "--to", action);
      return {
        args: {
          action,
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          path,
        },
        help: false,
        kind: "sdpub-stage",
      };
  }
}

function normalizeSdpubChapterArguments(
  action: CLISdpubChapterAction,
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
): CLISdpubChapterArguments {
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
            "Missing --to. `sdpub chapter reset` requires planned, sourced, or graphed.",
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
            "Missing --input-format. `sdpub chapter set-source` requires txt or markdown.",
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
    readonly language?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly serial?: string;
    readonly stage?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectHelpFlag("digest-dir", values["digest-dir"]);
  rejectHelpFlag("input", values.input);
  rejectHelpFlag("input-format", values["input-format"]);
  rejectHelpFlag("llm", values.llm);
  rejectHelpFlag("output", values.output);
  rejectHelpFlag("output-format", values["output-format"]);
  rejectHelpFlag("prompt", values.prompt);
  rejectHelpFlag("serial", values.serial);
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

  return {
    help: true,
    helpText: renderHelpTopicText(parseHelpTopic(positionals[0])),
    kind: "help",
  };
}

function parseStatusArguments(
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
    readonly language?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly serial?: string;
    readonly stage?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectStatusFlag("digest-dir", values["digest-dir"]);
  rejectStatusFlag("input", values.input);
  rejectStatusFlag("input-format", values["input-format"]);
  rejectStatusFlag("output", values.output);
  rejectStatusFlag("output-format", values["output-format"]);
  rejectStatusFlag("prompt", values.prompt);
  rejectStatusFlag("serial", values.serial);
  rejectStatusFlag("stage", values.stage);
  rejectStatusMetaFlags(values);

  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `status` command does not support --verbose.",
        "spinedigest status --help",
      ),
    );
  }

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        "spinedigest status --help",
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
      kind: "status",
    };
  }

  return {
    args,
    help: false,
    kind: "status",
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

function isSdpubChapterAction(
  value: string | undefined,
): value is CLISdpubChapterAction {
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

function isSdpubStageAction(
  value: string | undefined,
): value is CLISdpubStageAction {
  return value === "advance" || value === "pending";
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
      `Invalid --input-format for sdpub chapter source: ${value}. Expected txt or markdown.`,
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
        "`sdpub chapter reset` does not support --to summarized.",
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

function parseSdpubMetaPatch(
  values: SdpubMetaFlagValues,
  subcommand: Exclude<SDPubSubcommand, "chapter">,
): SdpubMetaPatch | undefined {
  const helpRoute = sdpubSubcommandHelpRoute(subcommand);
  const patch = {
    ...parseSdpubStringMetaPatch(values, "title", "title", helpRoute),
    ...parseSdpubStringMetaPatch(values, "language", "language", helpRoute),
    ...parseSdpubStringMetaPatch(values, "identifier", "identifier", helpRoute),
    ...parseSdpubStringMetaPatch(values, "publisher", "publisher", helpRoute),
    ...parseSdpubStringMetaPatch(
      values,
      "publishedAt",
      "published-at",
      helpRoute,
    ),
    ...parseSdpubStringMetaPatch(
      values,
      "description",
      "description",
      helpRoute,
    ),
    ...parseSdpubAuthorsMetaPatch(values, helpRoute),
  } satisfies SdpubMetaPatch;

  if (Object.keys(patch).length === 0) {
    return undefined;
  }
  if (subcommand !== "meta") {
    throw new Error(
      withHelpRoute(
        `The \`sdpub ${subcommand}\` subcommand does not support metadata edit flags.`,
        sdpubSubcommandHelpRoute(subcommand),
      ),
    );
  }

  return patch;
}

function parseSdpubStringMetaPatch(
  values: SdpubMetaFlagValues,
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
): Partial<SdpubMetaPatch> {
  const value = values[flag];
  const clearFlag = `clear-${flag}` as keyof SdpubMetaFlagValues;
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
    } as Partial<SdpubMetaPatch>;
  }

  return {};
}

function parseSdpubAuthorsMetaPatch(
  values: SdpubMetaFlagValues,
  helpRoute: string,
): Partial<SdpubMetaPatch> {
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
        `The \`sdpub chapter ${action}\` action does not support ${flag}.`,
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
        `The \`sdpub chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectSdpubStageActionFlag(
  value: string | undefined,
  flag: string,
  action: CLISdpubStageAction,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub stage ${action}\` action does not support ${flag}.`,
        "spinedigest sdpub stage --help",
      ),
    );
  }
}

function rejectSdpubChapterFlag(name: string, value: string | undefined): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub chapter\` command does not support --${name}.`,
        "spinedigest sdpub chapter --help",
      ),
    );
  }
}

function rejectSdpubStageFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub stage\` command does not support --${name}.`,
        "spinedigest sdpub stage --help",
      ),
    );
  }
}

function rejectConvertMetaFlags(values: SdpubMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The main convert command does not support ${flag}.`,
        CLI_HELP_ROUTES.command,
      ),
    );
  }
}

function rejectSdpubChapterMetaFlags(values: SdpubMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values, { includeTitle: false })) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub chapter\` command does not support ${flag}.`,
        "spinedigest sdpub chapter --help",
      ),
    );
  }
}

function rejectSdpubStageMetaFlags(values: SdpubMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`sdpub stage\` command does not support ${flag}.`,
        "spinedigest sdpub stage --help",
      ),
    );
  }
}

function rejectHelpMetaFlags(values: SdpubMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support ${flag}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusMetaFlags(values: SdpubMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`status\` command does not support ${flag}.`,
        "spinedigest status --help",
      ),
    );
  }
}

function listPresentMetaFlags(
  values: SdpubMetaFlagValues,
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
  action: CLISdpubChapterAction,
  helpRoute: string,
): asserts chapterId is number {
  if (chapterId === undefined) {
    throw new Error(
      withHelpRoute(
        `Missing --chapter. \`sdpub chapter ${action}\` requires a chapter id.`,
        helpRoute,
      ),
    );
  }
}

function rejectHelpFlag(name: string, value: string | undefined): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support --${name}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusFlag(name: string, value: string | undefined): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`status\` command does not support --${name}.`,
        "spinedigest status --help",
      ),
    );
  }
}
