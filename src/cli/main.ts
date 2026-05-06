import { parseCLIArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { runStatusCommand } from "./status.js";
import { runSdpubCommand } from "./sdpub.js";
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
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
}
