import { rename, rm, stat } from "fs/promises";
import { basename, dirname, join } from "path";

import {
  createWikiGraphTempDirectory,
  DirectoryDocument,
  formatLocatedWikiGraphUri,
  formatWikiGraphCommandUri,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args.js";
import { runConvertCommand } from "../convert.js";
import {
  formatCLIJSON,
  formatCliCommand,
  writeTextToStdout,
} from "../../support/index.js";

export async function createArchive(args: CLIArchiveArguments): Promise<void> {
  const outputPath = await prepareCreateArchiveOutputPath(args);

  try {
    await writeCreatedArchiveFile(args, outputPath);
    await finalizeCreatedArchiveFile(args, outputPath);
  } finally {
    if (outputPath !== args.archivePath) {
      await rm(outputPath, { force: true, recursive: true });
    }
  }

  await writeCreatedArchive(args);
}

async function writeCreatedArchiveFile(
  args: CLIArchiveArguments,
  outputPath: string,
): Promise<void> {
  if (args.importPath === undefined) {
    await createEmptyArchive(outputPath);
    return;
  }

  await runConvertCommand({
    help: false,
    inputPath: args.importPath,
    outputFormat: "wikg",
    outputPath,
    targetStage: "sourced",
    verbose: false,
  });
}

async function createEmptyArchive(outputPath: string): Promise<void> {
  const directoryPath = await createWikiGraphTempDirectory("archive-write");
  const document = await DirectoryDocument.open(directoryPath);

  try {
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({
          items: [],
          version: TOC_FILE_VERSION,
        });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(directoryPath, outputPath);
  } finally {
    await rm(directoryPath, { force: true, recursive: true });
  }
}

async function prepareCreateArchiveOutputPath(
  args: CLIArchiveArguments,
): Promise<string> {
  if (args.replace !== true && (await fileExists(args.archivePath))) {
    throw new Error(formatArchiveAlreadyExistsMessage(args.archivePath));
  }

  if (args.replace !== true) {
    return args.archivePath;
  }

  return join(
    dirname(args.archivePath),
    `.${basename(args.archivePath)}.${process.pid}.${Date.now()}.tmp.wikg`,
  );
}

async function finalizeCreatedArchiveFile(
  args: CLIArchiveArguments,
  outputPath: string,
): Promise<void> {
  if (outputPath === args.archivePath) {
    return;
  }

  await rename(outputPath, args.archivePath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeENOENTError(error)) {
      return false;
    }

    throw error;
  }
}

function isNodeENOENTError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function formatArchiveAlreadyExistsMessage(archivePath: string): string {
  const uri = formatWikiGraphCommandUri(archivePath);

  return [
    `Archive already exists: ${archivePath}`,
    `Use \`${formatCliCommand([uri, "inspect"])}\` to view it, or rerun with \`--replace\` to overwrite it.`,
  ].join("\n");
}

async function writeCreatedArchive(args: CLIArchiveArguments): Promise<void> {
  if (args.json === true) {
    await writeTextToStdout(
      formatCLIJSON({ uri: formatLocatedWikiGraphUri(args.archivePath) }),
    );
    return;
  }

  await writeTextToStdout("<archive>\n");
}
