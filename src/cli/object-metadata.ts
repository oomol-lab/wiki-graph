import { readFile } from "fs/promises";

import {
  ObjectMetadataKind,
  type ObjectMetadataTarget,
} from "../document/index.js";
import { SpineDigestFile } from "../wikg/index.js";

import type { CLIObjectMetadataArguments } from "./args.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";

export async function runObjectMetadataCommand(
  args: CLIObjectMetadataArguments,
): Promise<void> {
  const target = parseObjectMetadataTarget(args.objectPath);

  switch (args.action) {
    case "get":
      await new SpineDigestFile(args.archivePath).readDocument(
        async (document) => {
          await writeMetadataMap(
            await document.metadata.getMap(args.objectPath),
            args.json ?? false,
          );
        },
      );
      return;
    case "set": {
      const value = await readMetadataInput(args, { jsonRequired: true });
      const map = parseMetadataMap(value);

      await new SpineDigestFile(args.archivePath).write(async (document) => {
        await document.metadata.replaceMap(target, map);
        await writeMetadataMap(
          await document.metadata.getMap(args.objectPath),
          args.json ?? false,
        );
      });
      return;
    }
    case "put": {
      const key = normalizeMetadataKey(args.key);
      const value = await readMetadataInput(args, { jsonRequired: false });

      await new SpineDigestFile(args.archivePath).write(async (document) => {
        await document.metadata.put(target, key, value);
        await writeMetadataMap(
          await document.metadata.getMap(args.objectPath),
          args.json ?? false,
        );
      });
      return;
    }
    case "delete":
      await new SpineDigestFile(args.archivePath).write(async (document) => {
        await document.metadata.deleteKey(
          args.objectPath,
          normalizeMetadataKey(args.key),
        );
        await writeMetadataMap(
          await document.metadata.getMap(args.objectPath),
          args.json ?? false,
        );
      });
      return;
    case "clear":
      await new SpineDigestFile(args.archivePath).write(async (document) => {
        await document.metadata.clear(args.objectPath);
        await writeMetadataMap(
          await document.metadata.getMap(args.objectPath),
          args.json ?? false,
        );
      });
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

function parseObjectMetadataTarget(objectPath: string): ObjectMetadataTarget {
  if (objectPath === "") {
    return { kind: ObjectMetadataKind.Archive, objectPath };
  }

  const chapterMatch = /^chapter\/([1-9][0-9]*)(?:\/.*)?$/u.exec(objectPath);
  if (chapterMatch?.[1] !== undefined) {
    return {
      chapterId: Number(chapterMatch[1]),
      kind: ObjectMetadataKind.Chapter,
      objectPath,
    };
  }

  const chunkMatch = /^chunk\/([1-9][0-9]*)$/u.exec(objectPath);
  if (chunkMatch?.[1] !== undefined) {
    return {
      chunkId: Number(chunkMatch[1]),
      kind: ObjectMetadataKind.Chunk,
      objectPath,
    };
  }

  const entityMatch = /^entity\/(Q[1-9][0-9]*)$/u.exec(objectPath);
  if (entityMatch?.[1] !== undefined) {
    return {
      entityQid: entityMatch[1],
      kind: ObjectMetadataKind.Entity,
      objectPath,
    };
  }

  const tripleMatch = /^triple\/(Q[1-9][0-9]*)\/([^/]+)\/(Q[1-9][0-9]*)$/u.exec(
    objectPath,
  );
  if (tripleMatch?.[1] !== undefined) {
    return {
      kind: ObjectMetadataKind.Triple,
      objectPath,
      tripleObjectQid: tripleMatch[3]!,
      triplePredicate: decodeURIComponent(tripleMatch[2]!),
      tripleSubjectQid: tripleMatch[1],
    };
  }

  return {
    kind: ObjectMetadataKind.Object,
    objectPath,
  };
}
