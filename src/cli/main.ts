import { parseCLIArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { runStatusCommand } from "./status.js";
import { runSdpubCommand } from "./sdpub.js";
import { LLMPaymentRequiredError } from "../llm/index.js";
import { formatError } from "../utils/node-error.js";

export async function main(): Promise<void> {
  try {
    const parsed = parseCLIArguments();

    if (parsed.help) {
      process.stdout.write(`${parsed.helpText}\n`);
      return;
    }

    switch (parsed.kind) {
      case "convert":
        await runConvertCommand(parsed.args);
        return;
      case "sdpub":
        if (parsed.args === undefined) {
          throw new Error("Internal error: missing sdpub command arguments.");
        }

        await runSdpubCommand(parsed.args);
        return;
      case "status":
        await runStatusCommand();
        return;
    }
  } catch (error) {
    process.stderr.write(`${formatCLIError(error)}\n`);
    process.exitCode = 1;
  }
}

function formatCLIError(error: unknown): string {
  if (error instanceof LLMPaymentRequiredError) {
    return "LLM payment required. Check your provider billing status or account balance.";
  }

  return formatError(error);
}
