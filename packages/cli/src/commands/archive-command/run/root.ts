import { formatLocatedWikiGraphUri } from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args/index.js";
import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import { getArchivePath } from "./uri.js";

export async function writeArchiveRoot(
  args: CLIArchiveArguments,
): Promise<void> {
  const archivePath = getArchivePath(args.objectId!);

  if (args.format === "json") {
    await writeTextToStdout(
      formatCLIJSON({ uri: formatLocatedWikiGraphUri(archivePath) }),
    );
    return;
  }

  await writeTextToStdout("<archive>\n");
}
