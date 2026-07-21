import type { CLILegacyArguments } from "../args/index.js";
import { migrateLegacySdpubToWikg } from "wiki-graph-core";

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
