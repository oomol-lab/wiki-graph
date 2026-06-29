import { parseCLIArguments } from "./args.js";
import { runArchiveCommand } from "./archive.js";
import { runArchiveChapterCommand } from "./archive-chapter.js";
import {
  runArchiveCoverCommand,
  runArchiveMetaCommand,
} from "./archive-maintenance.js";
import { runConvertCommand } from "./convert.js";
import { renderMainHelpText } from "./help.js";
import { runQueueCommand } from "./queue.js";
import { runStatusCommand } from "./status.js";
import { LLMPaymentRequiredError } from "../llm/index.js";
import { formatError } from "../utils/node-error.js";
import { formatCLIJSON, formatCLIJSONLine } from "./json.js";
import { readCLIVersion } from "./version.js";

export async function main(): Promise<void> {
  try {
    if (shouldPrintDefaultHelp()) {
      process.stdout.write(`${renderMainHelpText()}\n`);
      return;
    }

    const parsed = parseCLIArguments();

    if (parsed.help) {
      process.stdout.write(`${parsed.helpText}\n`);
      return;
    }

    switch (parsed.kind) {
      case "version":
        process.stdout.write(`${readCLIVersion()}\n`);
        return;
      case "convert":
        await runConvertCommand(parsed.args);
        return;
      case "meta":
        await runArchiveMetaCommand(parsed.args);
        return;
      case "cover":
        await runArchiveCoverCommand(parsed.args);
        return;
      case "chapter":
        await runArchiveChapterCommand(parsed.args);
        return;
      case "archive":
        await runArchiveCommand(parsed.args);
        return;
      case "queue":
        await runQueueCommand(parsed.args);
        return;
      case "config-status":
        await runStatusCommand(parsed.args);
        return;
    }
  } catch (error) {
    if (shouldWriteJSONError(process.argv.slice(2))) {
      process.stdout.write(formatCLIJSON(createCLIErrorObject(error)));
      process.exitCode = 1;
      return;
    }
    if (shouldWriteJSONLError(process.argv.slice(2))) {
      process.stdout.write(formatCLIJSONLine(createCLIErrorObject(error)));
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${formatCLIError(error)}\n`);
    process.exitCode = 1;
  }
}

function shouldPrintDefaultHelp(): boolean {
  return process.argv.slice(2).length === 0 && process.stdin.isTTY === true;
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
  return argv.includes("--json");
}

function shouldWriteJSONLError(argv: readonly string[]): boolean {
  return argv.includes("--jsonl");
}
