import { rm } from "fs/promises";
import { resolve } from "path";

import { SpineDigestApp, type SpineDigestAppOptions } from "../index.js";
import type { SpineDigest } from "../facade/index.js";

import type { CLIArguments } from "./args.js";
import { loadCLIConfig, type CLIConfig } from "./config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import {
  type CLIFormat,
  inferCLIFormatFromPath,
  isTextCLIFormat,
} from "./formats.js";
import { buildLLMOptions } from "./llm.js";
import {
  createTemporaryOutputPath,
  readTextStreamFromStdin,
  removeTemporaryDirectory,
  writeTextFileToStdout,
} from "./io.js";
import { createCLIProgressRenderer } from "./progress.js";

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

  const inputFormat = input.format;
  const requiresDigest = inputFormat !== "sdpub";
  const digestDirPath = await prepareDigestDirPath(args, requiresDigest);
  const config = await loadRequiredConfig(requiresDigest);
  const app = new SpineDigestApp(
    createAppOptions(args, config, requiresDigest),
  );
  const progressRenderer = createCLIProgressRenderer({
    enabled:
      requiresDigest &&
      output.standardStream !== "stdout" &&
      process.stderr.isTTY === true &&
      !args.verbose,
  });

  if (inputFormat === "sdpub") {
    if (input.path === undefined) {
      throw new Error("Internal error: sdpub input requires a file path.");
    }

    try {
      await app.openSession(input.path, async (digest) => {
        await writeDigestOutput(digest, output);
      });
      return;
    } finally {
      await progressRenderer.stop();
    }
  }

  const extractionPrompt = args.prompt ?? config.prompt;

  try {
    if (input.path === undefined) {
      if (process.stdin.isTTY) {
        throw new Error(
          withHelpRoute(
            "Missing --input. Refusing to read from interactive stdin. Use --input <path> or pipe text into stdin.",
            CLI_HELP_ROUTES.runtime,
          ),
        );
      }

      await app.digestTextStreamSession(
        {
          ...(digestDirPath === undefined
            ? {}
            : { documentDirPath: digestDirPath }),
          ...(progressRenderer.onProgress === undefined
            ? {}
            : { onProgress: progressRenderer.onProgress }),
          sourceFormat: input.format,
          stream: readTextStreamFromStdin(),
          ...(extractionPrompt === undefined ? {} : { extractionPrompt }),
        },
        async (digest) => {
          await writeDigestOutput(digest, output);
        },
      );
      return;
    }

    switch (inputFormat) {
      case "epub":
        await app.digestEpubSession(
          {
            ...(digestDirPath === undefined
              ? {}
              : { documentDirPath: digestDirPath }),
            ...(progressRenderer.onProgress === undefined
              ? {}
              : { onProgress: progressRenderer.onProgress }),
            path: input.path,
            ...(extractionPrompt === undefined ? {} : { extractionPrompt }),
          },
          async (digest) => {
            await writeDigestOutput(digest, output);
          },
        );
        return;
      case "markdown":
        await app.digestMarkdownSession(
          {
            ...(digestDirPath === undefined
              ? {}
              : { documentDirPath: digestDirPath }),
            ...(progressRenderer.onProgress === undefined
              ? {}
              : { onProgress: progressRenderer.onProgress }),
            path: input.path,
            ...(extractionPrompt === undefined ? {} : { extractionPrompt }),
          },
          async (digest) => {
            await writeDigestOutput(digest, output);
          },
        );
        return;
      case "txt":
        await app.digestTxtSession(
          {
            ...(digestDirPath === undefined
              ? {}
              : { documentDirPath: digestDirPath }),
            ...(progressRenderer.onProgress === undefined
              ? {}
              : { onProgress: progressRenderer.onProgress }),
            path: input.path,
            ...(extractionPrompt === undefined ? {} : { extractionPrompt }),
          },
          async (digest) => {
            await writeDigestOutput(digest, output);
          },
        );
        return;
    }
  } finally {
    await progressRenderer.stop();
  }
}

async function prepareDigestDirPath(
  args: CLIArguments,
  requiresDigest: boolean,
): Promise<string | undefined> {
  const normalizedPath = normalizeIOPath(args.digestDirPath);

  if (normalizedPath === undefined || !requiresDigest) {
    return undefined;
  }

  const resolvedPath = resolve(normalizedPath);

  await rm(resolvedPath, { force: true, recursive: true });

  return resolvedPath;
}

async function loadRequiredConfig(requiresDigest: boolean): Promise<CLIConfig> {
  const config = await loadCLIConfig();

  if (!requiresDigest) {
    return config;
  }

  if (config.llm?.provider === undefined || config.llm.model === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing LLM configuration. Set `llm.provider` and `llm.model` in ~/.spinedigest/config.json or the matching SPINEDIGEST_LLM_* environment variables.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }

  return config;
}

function createAppOptions(
  args: CLIArguments,
  config: CLIConfig,
  requiresDigest: boolean,
): SpineDigestAppOptions {
  const llmOptions = !requiresDigest ? undefined : buildLLMOptions(config);

  return {
    ...(config.paths?.debugLogDir === undefined
      ? {}
      : { debugLogDirPath: config.paths.debugLogDir }),
    ...(args.verbose ? { verbose: true } : {}),
    ...(llmOptions === undefined ? {} : { llm: llmOptions }),
  };
}

async function writeDigestOutput(
  digest: SpineDigest,
  output: ResolvedOutputEndpoint,
): Promise<void> {
  if (output.path !== undefined) {
    await writeDigestToFile(digest, output.path, output.format);
    return;
  }

  if (output.standardStream !== "stdout") {
    throw new Error("Internal error: missing output target.");
  }

  const temporaryOutput = await createTemporaryOutputPath(
    "spinedigest-cli-output-",
    extensionForFormat(output.format),
  );

  try {
    await writeDigestToFile(digest, temporaryOutput.filePath, output.format);
    await writeTextFileToStdout(temporaryOutput.filePath);
  } finally {
    await removeTemporaryDirectory(temporaryOutput.directoryPath);
  }
}

async function writeDigestToFile(
  digest: SpineDigest,
  path: string,
  format: CLIFormat,
): Promise<void> {
  switch (format) {
    case "epub":
      await digest.exportEpub(path);
      return;
    case "markdown":
    case "txt":
      await digest.exportText(path);
      return;
    case "sdpub":
      await digest.saveAs(path);
      return;
  }
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
    case "sdpub":
      return ".sdpub";
    case "txt":
      return ".txt";
  }
}
