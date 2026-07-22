import { renderMainHelpText } from "../args/help.js";
import { parseCLIArguments } from "../args/index.js";
import {
  runArchiveChapterCommand,
  runArchiveCommand,
  runArchiveCoverCommand,
  runArchiveIndexCommand,
  runArchiveMetaCommand,
  runConvertCommand,
  runGcCommand,
  runLegacyCommand,
  runLibraryCommand,
  runLocalConfigCommand,
  runObjectMetadataCommand,
  runQueueCommand,
} from "../commands/index.js";
import { formatCLIJSON, formatCLIJSONLine } from "../support/index.js";
import { readCLIVersion } from "../support/index.js";
import { formatError, LLMPaymentRequiredError } from "wiki-graph-core";

export interface WikiGraphCLIDispatchInput {
  readonly argv: readonly string[];
  readonly stdinIsTTY?: boolean | undefined;
  readonly stderr: NodeJS.WritableStream;
  readonly stdout: NodeJS.WritableStream;
}

export interface WikiGraphCLIDispatchResult {
  readonly exitCode: number;
}

export async function dispatchWikiGraphCLI(
  input: WikiGraphCLIDispatchInput,
): Promise<WikiGraphCLIDispatchResult> {
  try {
    if (shouldPrintDefaultHelp(input.argv, input.stdinIsTTY)) {
      input.stdout.write(`${renderMainHelpText()}\n`);
      return { exitCode: 0 };
    }

    const parsed = parseCLIArguments([...input.argv]);

    if (parsed.help) {
      input.stdout.write(`${parsed.helpText}\n`);
      return { exitCode: 0 };
    }

    switch (parsed.kind) {
      case "version":
        input.stdout.write(`${readCLIVersion()}\n`);
        return { exitCode: 0 };
      case "convert":
        await runConvertCommand(parsed.args);
        return { exitCode: 0 };
      case "meta":
        await runArchiveMetaCommand(parsed.args);
        return { exitCode: 0 };
      case "cover":
        await runArchiveCoverCommand(parsed.args);
        return { exitCode: 0 };
      case "object-metadata":
        await runObjectMetadataCommand(parsed.args);
        return { exitCode: 0 };
      case "library":
        await runLibraryCommand(parsed.args);
        return { exitCode: 0 };
      case "chapter":
        await runArchiveChapterCommand(parsed.args);
        return { exitCode: 0 };
      case "archive":
        await runArchiveCommand(parsed.args);
        return { exitCode: 0 };
      case "archive-index":
        await runArchiveIndexCommand(parsed.args);
        return { exitCode: 0 };
      case "queue":
        await runQueueCommand(parsed.args);
        return { exitCode: 0 };
      case "gc":
        await runGcCommand(parsed.args);
        return { exitCode: 0 };
      case "legacy":
        await runLegacyCommand(parsed.args);
        return { exitCode: 0 };
      case "local-config":
        await runLocalConfigCommand(parsed.args);
        return { exitCode: 0 };
    }
  } catch (error) {
    if (shouldWriteJSONError(input.argv)) {
      input.stdout.write(formatCLIJSON(createCLIErrorObject(error)));
      return { exitCode: 1 };
    }
    if (shouldWriteJSONLError(input.argv)) {
      input.stdout.write(formatCLIJSONLine(createCLIErrorObject(error)));
      return { exitCode: 1 };
    }
    input.stderr.write(`${formatCLIError(error)}\n`);
    return { exitCode: 1 };
  }
}

function shouldPrintDefaultHelp(
  argv: readonly string[],
  stdinIsTTY: boolean | undefined,
): boolean {
  return argv.length === 0 && stdinIsTTY === true;
}

function formatCLIError(error: unknown): string {
  if (error instanceof LLMPaymentRequiredError) {
    return "LLM payment required. Check your provider billing status or account balance.";
  }

  return formatError(error);
}

function createCLIErrorObject(error: unknown): {
  readonly error: {
    readonly message: string;
    readonly type: string;
  };
} {
  return {
    error: {
      message: formatCLIError(error),
      type:
        error instanceof LLMPaymentRequiredError
          ? "llm_payment_required"
          : "error",
    },
  };
}

function shouldWriteJSONError(argv: readonly string[]): boolean {
  return argv.some((item) => item === "--json" || item.startsWith("--json="));
}

function shouldWriteJSONLError(argv: readonly string[]): boolean {
  return argv.includes("--jsonl");
}
