import { parseArgs } from "util";

import { type CLIFormat, parseCLIFormat } from "./formats.js";
import {
  parseHelpTopic,
  renderHelpTopicText,
  renderMainHelpText,
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
  readonly outputPath?: string;
  readonly outputFormat?: CLIFormat;
  readonly prompt?: string;
  readonly verbose: boolean;
}

export interface CLISdpubArguments {
  readonly inputPath: string;
  readonly serialId?: number;
  readonly subcommand: SDPubSubcommand;
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
      readonly help: true;
      readonly helpText: string;
      readonly kind: "help";
    };

export function parseCLIArguments(
  argv = process.argv.slice(2),
): ParsedCLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      "digest-dir": {
        type: "string",
      },
      input: {
        type: "string",
      },
      "input-format": {
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

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.join(" ")}. Use --input and --output instead.`,
    );
  }

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
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
    readonly serial?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const subcommand = positionals[0];

  if (positionals.length > 1) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
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
      `Missing sdpub subcommand. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
    );
  }

  if (!SDPUB_SUBCOMMANDS.includes(subcommand as SDPubSubcommand)) {
    throw new Error(
      `Invalid sdpub subcommand: ${subcommand}. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
    );
  }

  const parsedSubcommand = subcommand as SDPubSubcommand;

  if (values["digest-dir"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --digest-dir. Use the main command for digest generation.",
    );
  }
  if (values["input-format"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --input-format. They always read .sdpub archives.",
    );
  }
  if (values.output !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.",
    );
  }
  if (values["output-format"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --output-format. Their output format is fixed by the subcommand.",
    );
  }
  if (values.prompt !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --prompt. It only applies to digest generation from source inputs.",
    );
  }
  if (values.verbose) {
    throw new Error("The `sdpub` subcommands do not support --verbose.");
  }

  const serialId =
    values.serial === undefined
      ? undefined
      : parseSerialId(values.serial, "--serial");

  if (parsedSubcommand === "cat" && serialId === undefined && !help) {
    throw new Error("Missing --serial. `spinedigest sdpub cat` requires it.");
  }
  if (parsedSubcommand !== "cat" && serialId !== undefined) {
    throw new Error(
      `The \`sdpub ${parsedSubcommand}\` subcommand does not support --serial.`,
    );
  }

  const inputPath = values.input;

  if (!help) {
    if (inputPath === undefined || inputPath === "-") {
      throw new Error(
        "The `sdpub` subcommands require --input <path>. stdin is not supported.",
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
      ...(serialId === undefined ? {} : { serialId }),
      subcommand: parsedSubcommand,
    },
    help: false,
    kind: "sdpub",
  };
}

function parseHelpArguments(
  positionals: readonly string[],
  values: {
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
    readonly serial?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectHelpFlag("digest-dir", values["digest-dir"]);
  rejectHelpFlag("input", values.input);
  rejectHelpFlag("input-format", values["input-format"]);
  rejectHelpFlag("output", values.output);
  rejectHelpFlag("output-format", values["output-format"]);
  rejectHelpFlag("prompt", values.prompt);
  rejectHelpFlag("serial", values.serial);

  if (values.verbose) {
    throw new Error("The `help` command does not support --verbose.");
  }

  if (positionals.length > 1) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
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

function parseSerialId(value: string, flag: string): number {
  const normalized = value.trim();

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      `Invalid ${flag}: ${value}. Expected a non-negative integer.`,
    );
  }

  return Number(normalized);
}

function rejectHelpFlag(name: string, value: string | undefined): void {
  if (value !== undefined) {
    throw new Error(`The \`help\` command does not support --${name}.`);
  }
}
