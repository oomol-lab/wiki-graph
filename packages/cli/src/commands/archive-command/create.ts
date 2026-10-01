import { WikiGraphArchiveExistsError } from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../args/index.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
import { createCLIProgressRenderer } from "../../runtime/index.js";
import {
  formatCLIJSON,
  formatCliCommand,
  formatWikiGraphCommandUri,
  writeTextToStdout,
} from "../../support/index.js";

export async function createArchive(args: CLIArchiveArguments): Promise<void> {
  const progressRenderer = createCLIProgressRenderer({
    enabled: args.importPath !== undefined && process.stderr.isTTY === true,
  });
  try {
    const result = await getWikiGraphSDK().archives.create({
      ...(args.importPath === undefined ? {} : { importPath: args.importPath }),
      ...(progressRenderer.onProgress === undefined
        ? {}
        : { onProgress: progressRenderer.onProgress }),
      path: args.archivePath,
      replace: args.replace ?? false,
    });
    await writeTextToStdout(
      args.json === true
        ? formatCLIJSON({ uri: result.locatedUri })
        : "<archive>\n",
    );
  } catch (error) {
    if (!(error instanceof WikiGraphArchiveExistsError)) throw error;
    throw new Error(formatArchiveAlreadyExistsMessage(error.path), {
      cause: error,
    });
  } finally {
    await progressRenderer.stop();
  }
}

function formatArchiveAlreadyExistsMessage(archivePath: string): string {
  const uri = formatWikiGraphCommandUri(archivePath);
  return [
    `Archive already exists: ${archivePath}`,
    `Use \`${formatCliCommand([uri, "inspect"])}\` to view it, or rerun with \`--replace\` to overwrite it.`,
  ].join("\n");
}
