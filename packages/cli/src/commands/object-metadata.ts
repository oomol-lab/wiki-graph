import { readFile } from "fs/promises";

import type { CLIObjectMetadataArguments } from "../args/index.js";
import { getWikiGraphSDK } from "../runtime/context.js";
import {
  readTextStreamFromStdin,
  writeTextToStdout,
} from "../support/index.js";
import { parseCLIArchiveTarget } from "../support/archive-target.js";
import { formatCLIJSON } from "../support/index.js";

export async function runObjectMetadataCommand(
  args: CLIObjectMetadataArguments,
): Promise<void> {
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );

  switch (args.action) {
    case "get": {
      await writeMetadataMap(
        await archive.getMetadata(args.objectPath),
        args.json ?? false,
      );
      return;
    }
    case "set": {
      const value = await readMetadataInput(args, { jsonRequired: true });
      const map = parseMetadataMap(value);

      await writeMetadataMap(
        await archive.replaceMetadata(args.objectPath, map),
        args.json ?? false,
      );
      return;
    }
    case "put": {
      const key = normalizeMetadataKey(args.key);
      const value = await readMetadataInput(args, { jsonRequired: false });

      await writeMetadataMap(
        await archive.putMetadata(args.objectPath, key, value),
        args.json ?? false,
      );
      return;
    }
    case "delete":
      await writeMetadataMap(
        await archive.deleteMetadata(
          args.objectPath,
          normalizeMetadataKey(args.key),
        ),
        args.json ?? false,
      );
      return;
    case "clear":
      await writeMetadataMap(
        await archive.clearMetadata(args.objectPath),
        args.json ?? false,
      );
      return;
  }
}

async function readMetadataInput(
  args: CLIObjectMetadataArguments,
  options: { readonly jsonRequired: boolean },
): Promise<unknown> {
  const raw = await readRawInput(args);

  if (args.json === true || options.jsonRequired) {
    return parseJSONInput(raw);
  }

  return raw;
}

async function readRawInput(args: CLIObjectMetadataArguments): Promise<string> {
  const sources = [
    args.inputValue === undefined ? undefined : "positional value",
    args.inputPath === undefined ? undefined : "--input",
    args.jsonInputValue === undefined ? undefined : "--json value",
  ].filter((source): source is string => source !== undefined);

  if (sources.length > 1) {
    throw new Error(`Choose only one input source: ${sources.join(", ")}.`);
  }
  if (args.jsonInputValue !== undefined) {
    return args.jsonInputValue;
  }
  if (args.inputValue !== undefined) {
    return args.inputValue;
  }
  if (args.inputPath === "-") {
    let content = "";
    for await (const chunk of readTextStreamFromStdin()) {
      content += chunk;
    }
    return content;
  }
  if (args.inputPath !== undefined) {
    return await readFile(args.inputPath, "utf8");
  }
  throw new Error(
    "Missing input. Pass a value, use --input <path>, or use --input - for stdin.",
  );
}

function parseMetadataMap(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Metadata set requires a JSON object.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function parseJSONInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeMetadataKey(key: string | undefined): string {
  const normalized = key?.trim() ?? "";

  if (normalized === "") {
    throw new Error("Metadata key cannot be empty.");
  }

  return normalized;
}

function writeMetadataMap(
  map: Readonly<Record<string, unknown>>,
  json: boolean,
): Promise<void> {
  if (json) {
    return writeTextToStdout(formatCLIJSON(map));
  }

  return writeTextToStdout(formatMetadataText(map));
}

function formatMetadataText(map: Readonly<Record<string, unknown>>): string {
  const lines = Object.entries(map).map(
    ([key, value]) => `${key}: ${formatMetadataTextValue(value)}`,
  );

  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n`;
}

function formatMetadataTextValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ");
  }

  return String(value);
}
