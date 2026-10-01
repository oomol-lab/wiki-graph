import type { CLILegacyArguments } from "../args/index.js";
import { migrateLegacySdpubToWikg } from "wiki-graph-sdk";
import { resolve } from "path";
import { NodeFile } from "../runtime/node-platform.js";

export async function runLegacyCommand(
  args: CLILegacyArguments,
): Promise<void> {
  switch (args.action) {
    case "migrate": {
      process.stderr.write(
        "`wg legacy migrate` is deprecated. Use `wg maintenance upgrade <sdpub-path>`.\n",
      );
      const outputPath = resolve(
        args.outputPath ?? defaultWikgOutputPath(args.inputPath),
      );
      await migrateLegacySdpubToWikg(
        new NodeFile(resolve(args.inputPath)),
        new NodeFile(outputPath),
      );

      process.stdout.write(`Wrote ${outputPath}\n`);
      return;
    }
  }
}

function defaultWikgOutputPath(inputPath: string): string {
  return inputPath.toLowerCase().endsWith(".sdpub")
    ? `${inputPath.slice(0, -".sdpub".length)}.wikg`
    : `${inputPath}.wikg`;
}
