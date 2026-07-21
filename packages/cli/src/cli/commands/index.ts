import type {
  CLIArguments,
  CLIArchiveArguments,
  CLIArchiveChapterArguments,
  CLIArchiveCoverArguments,
  CLIArchiveIndexArguments,
  CLIArchiveMetadataArguments,
  CLIGcArguments,
  CLILegacyArguments,
  CLILocalConfigArguments,
  CLIObjectMetadataArguments,
  CLIQueueArguments,
} from "../args.js";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  const command = await import("./archive.js");

  return command.runArchiveCommand(args);
}

export async function runArchiveChapterCommand(
  args: CLIArchiveChapterArguments,
): Promise<void> {
  const command = await import("./archive-chapter.js");

  return command.runArchiveChapterCommand(args);
}

export async function runArchiveIndexCommand(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  const command = await import("./archive-index.js");

  return command.runArchiveIndexCommand(args);
}

export async function runArchiveCoverCommand(
  args: CLIArchiveCoverArguments,
): Promise<void> {
  const command = await import("./archive-maintenance.js");

  return command.runArchiveCoverCommand(args);
}

export async function runArchiveMetaCommand(
  args: CLIArchiveMetadataArguments,
): Promise<void> {
  const command = await import("./archive-maintenance.js");

  return command.runArchiveMetaCommand(args);
}

export async function runConvertCommand(args: CLIArguments): Promise<void> {
  const command = await import("./convert.js");

  return command.runConvertCommand(args);
}

export async function runGcCommand(args: CLIGcArguments): Promise<void> {
  const command = await import("./gc.js");

  return command.runGcCommand(args);
}

export async function runLegacyCommand(
  args: CLILegacyArguments,
): Promise<void> {
  const command = await import("./legacy.js");

  return command.runLegacyCommand(args);
}

export async function runLocalConfigCommand(
  args: CLILocalConfigArguments,
): Promise<void> {
  const command = await import("./local-config.js");

  return command.runLocalConfigCommand(args);
}

export async function runObjectMetadataCommand(
  args: CLIObjectMetadataArguments,
): Promise<void> {
  const command = await import("./object-metadata.js");

  return command.runObjectMetadataCommand(args);
}

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  const command = await import("./queue/index.js");

  return command.runQueueCommand(args);
}

export async function runQueueWorker(): Promise<void> {
  const command = await import("./queue/index.js");

  return command.runQueueWorker();
}
