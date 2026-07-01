import type { CLILegacyArguments } from "./args.js";
import { migrateLegacySdpubToWikg } from "../legacy-sdpub/upgrade.js";

export async function runLegacyCommand(
  args: CLILegacyArguments,
): Promise<void> {
  switch (args.action) {
    case "migrate": {
      const result = await migrateLegacySdpubToWikg(
        args.inputPath,
        args.outputPath,
      );

      process.stdout.write(`Wrote ${result.outputPath}\n`);
      return;
    }
  }
}
