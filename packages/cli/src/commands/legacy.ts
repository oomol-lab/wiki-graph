import type { CLILegacyArguments } from "../args/index.js";
import { getWikiGraphSDK } from "../runtime/context.js";

export async function runLegacyCommand(
  args: CLILegacyArguments,
): Promise<void> {
  switch (args.action) {
    case "migrate": {
      process.stderr.write(
        "`wg legacy migrate` is deprecated. Use `wg maintenance upgrade <sdpub-path>`.\n",
      );
      const result = await getWikiGraphSDK().maintenance.migrateLegacy(
        args.inputPath,
        args.outputPath,
      );
      process.stdout.write(`Wrote ${result.outputPath}\n`);
      return;
    }
  }
}
