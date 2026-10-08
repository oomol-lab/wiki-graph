import type { CLIArchiveTitleArguments } from "../args/index.js";
import { getWikiGraphSDK } from "../runtime/context.js";
import { parseCLIArchiveTarget } from "../support/archive-target.js";
import { writeTextToStdout } from "../support/index.js";

export async function runArchiveTitleCommand(
  args: CLIArchiveTitleArguments,
): Promise<void> {
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );

  if (args.action === "clear") {
    await archive.setArchiveTitle(null);
    await writeTextToStdout("Cleared archive title.\n");
    return;
  }

  const title = args.title;
  if (title === undefined) {
    throw new Error("Missing archive title.");
  }
  const stored = await archive.setArchiveTitle(title);
  await writeTextToStdout(`${stored}\n`);
}
