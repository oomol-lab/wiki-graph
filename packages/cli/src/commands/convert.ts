import type { CLIArguments } from "../args/index.js";
import { getWikiGraphSDK } from "../runtime/context.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import {
  type CLIFormat,
  inferCLIFormatFromPath,
  isTextCLIFormat,
} from "../support/index.js";
import {
  createTemporaryOutputPath,
  readTextStreamFromStdin,
  removeTemporaryDirectory,
  writeTextFileToStdout,
} from "../support/index.js";
import { createCLIProgressRenderer } from "../runtime/index.js";

type TextCLIFormat = Extract<CLIFormat, "markdown" | "txt">;

type ResolvedInputEndpoint =
  | {
      readonly format: Exclude<CLIFormat, "markdown" | "txt"> | TextCLIFormat;
      readonly path: string;
      readonly standardStream?: undefined;
    }
  | {
      readonly format: TextCLIFormat;
      readonly path?: undefined;
      readonly standardStream: "stdin";
    };

type ResolvedOutputEndpoint =
  | {
      readonly format: CLIFormat;
      readonly path: string;
      readonly standardStream?: undefined;
    }
  | {
      readonly format: TextCLIFormat;
      readonly path?: undefined;
      readonly standardStream: "stdout";
    };

export async function runConvertCommand(args: CLIArguments): Promise<void> {
  const input = resolveInputEndpoint(args);
  const output = resolveOutputEndpoint(args);
  if (args.verbose && output.standardStream === "stdout") {
    throw new Error(
      withHelpRoute(
        "Cannot use --verbose when writing digest output to stdout. Use --output <path> or disable --verbose.",
        CLI_HELP_ROUTES.runtime,
      ),
    );
  }
  if (args.targetStage !== undefined && output.format !== "wikg") {
    throw new Error(
      withHelpRoute(
        "--stage is only supported when output format is wikg.",
        CLI_HELP_ROUTES.format,
      ),
    );
  }

  if (args.targetStage !== undefined && input.format === "wikg") {
    throw new Error(
      withHelpRoute(
        "--stage is only supported when creating .wikg from source input.",
        CLI_HELP_ROUTES.format,
      ),
    );
  }
  const progressRenderer = createCLIProgressRenderer({
    enabled:
      input.format !== "wikg" &&
      output.standardStream !== "stdout" &&
      process.stderr.isTTY === true &&
      !args.verbose,
  });

  const temporaryOutput =
    output.path === undefined
      ? await createTemporaryOutputPath(
          "wikigraph-cli-output-",
          extensionForFormat(output.format),
        )
      : undefined;
  const outputPath = output.path ?? temporaryOutput?.filePath;
  if (outputPath === undefined)
    throw new Error("Internal error: missing output target.");
  try {
    if (input.path === undefined && process.stdin.isTTY) {
      throw new Error(
        withHelpRoute(
          "Missing --input. Refusing to read from interactive stdin. Use --input <path> or pipe text into stdin.",
          CLI_HELP_ROUTES.runtime,
        ),
      );
    }
    try {
      await getWikiGraphSDK().conversions.convert({
        ...(args.digestDirPath === undefined
          ? {}
          : { digestDirectory: args.digestDirPath }),
        input:
          input.path === undefined
            ? {
                format: input.format,
                stream: readTextStreamFromStdin(),
              }
            : { format: input.format, path: input.path },
        ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
        ...(progressRenderer.onProgress === undefined
          ? {}
          : { onProgress: progressRenderer.onProgress }),
        output: { format: output.format, path: outputPath },
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(args.targetStage === undefined
          ? {}
          : { targetStage: args.targetStage }),
        ...(args.verbose ? { verbose: true } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isConfigurationErrorMessage(message)) {
        throw new Error(withHelpRoute(message, CLI_HELP_ROUTES.config), {
          cause: error,
        });
      }
      throw error;
    }
    if (temporaryOutput !== undefined) {
      await writeTextFileToStdout(temporaryOutput.filePath);
    }
  } finally {
    await progressRenderer.stop();
    if (temporaryOutput !== undefined) {
      await removeTemporaryDirectory(temporaryOutput.directoryPath);
    }
  }
}

function isConfigurationErrorMessage(message: string): boolean {
  return /(?:configuration|--llm|llm\.|embeddings\.|API key|provider|model)/iu.test(
    message,
  );
}

function resolveInputEndpoint(args: CLIArguments): ResolvedInputEndpoint {
  const normalizedPath = normalizeIOPath(args.inputPath);
  const inferredFormat =
    normalizedPath === undefined
      ? undefined
      : inferCLIFormatFromPath(normalizedPath);
  const format = args.inputFormat ?? inferredFormat;

  if (format === undefined) {
    throw new Error(
      withHelpRoute(
        normalizedPath === undefined
          ? "Cannot infer input format from stdin. Set --input-format."
          : `Cannot infer input format from ${normalizedPath}. Set --input-format.`,
        CLI_HELP_ROUTES.format,
      ),
    );
  }
  if (normalizedPath === undefined && !isTextCLIFormat(format)) {
    throw new Error(
      withHelpRoute(
        `stdin only supports txt or markdown, but got ${format}.`,
        CLI_HELP_ROUTES.format,
      ),
    );
  }

  if (normalizedPath === undefined) {
    const textFormat = format as TextCLIFormat;

    return {
      format: textFormat,
      standardStream: "stdin",
    };
  }

  return {
    format,
    path: normalizedPath,
  };
}

function resolveOutputEndpoint(args: CLIArguments): ResolvedOutputEndpoint {
  const normalizedPath = normalizeIOPath(args.outputPath);
  const inferredFormat =
    normalizedPath === undefined
      ? undefined
      : inferCLIFormatFromPath(normalizedPath);
  const format = args.outputFormat ?? inferredFormat;

  if (format === undefined) {
    throw new Error(
      withHelpRoute(
        normalizedPath === undefined
          ? "Cannot infer output format for stdout. Set --output-format."
          : `Cannot infer output format from ${normalizedPath}. Set --output-format.`,
        CLI_HELP_ROUTES.format,
      ),
    );
  }
  if (normalizedPath === undefined && !isTextCLIFormat(format)) {
    throw new Error(
      withHelpRoute(
        `stdout only supports txt or markdown, but got ${format}.`,
        CLI_HELP_ROUTES.format,
      ),
    );
  }

  if (normalizedPath === undefined) {
    const textFormat = format as TextCLIFormat;

    return {
      format: textFormat,
      standardStream: "stdout",
    };
  }

  return {
    format,
    path: normalizedPath,
  };
}

function normalizeIOPath(path: string | undefined): string | undefined {
  if (path === undefined) {
    return undefined;
  }

  return path === "-" ? undefined : path;
}

function extensionForFormat(format: CLIFormat): string {
  switch (format) {
    case "epub":
      return ".epub";
    case "markdown":
      return ".md";
    case "wikg":
      return ".wikg";
    case "txt":
      return ".txt";
  }
}
