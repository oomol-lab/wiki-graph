import { extname } from "path";

import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";

export const CLI_FORMATS = ["sdpub", "epub", "txt", "markdown"] as const;

export type CLIFormat = (typeof CLI_FORMATS)[number];

export function inferCLIFormatFromPath(path: string): CLIFormat | undefined {
  switch (extname(path).toLowerCase()) {
    case ".epub":
      return "epub";
    case ".markdown":
    case ".md":
      return "markdown";
    case ".sdpub":
      return "sdpub";
    case ".txt":
      return "txt";
    default:
      return undefined;
  }
}

export function isTextCLIFormat(
  format: CLIFormat,
): format is Extract<CLIFormat, "markdown" | "txt"> {
  return format === "markdown" || format === "txt";
}

export function parseCLIFormat(value: string, flag: string): CLIFormat {
  const normalized = value.trim().toLowerCase();

  if (isCLIFormat(normalized)) {
    return normalized;
  }

  throw new Error(
    withHelpRoute(
      `Invalid ${flag}: ${value}. Expected one of ${CLI_FORMATS.join(", ")}.`,
      CLI_HELP_ROUTES.format,
    ),
  );
}

function isCLIFormat(value: string): value is CLIFormat {
  return CLI_FORMATS.includes(value as CLIFormat);
}
