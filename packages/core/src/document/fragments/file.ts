import { join, resolve } from "path";

import type { SentenceRecord } from "../types.js";
import { DEFAULT_FRAGMENT_FILE_ACCESS } from "./file-access.js";
import type { FragmentFileAccess, FragmentFileContent } from "./types.js";

export async function readFragmentFile(
  fragmentPath: string,
  fileAccess: FragmentFileAccess = DEFAULT_FRAGMENT_FILE_ACCESS,
): Promise<FragmentFileContent> {
  return parseFragmentFileContent(
    fragmentPath,
    await readFragmentFileContent(fragmentPath, fileAccess),
  );
}

export function parseFragmentFileContent(
  fragmentPath: string,
  content: Uint8Array | undefined,
): FragmentFileContent {
  if (content === undefined) {
    throw new Error(`Fragment file does not exist: ${fragmentPath}`);
  }

  const rawContent = JSON.parse(
    Buffer.from(content).toString("utf8"),
  ) as unknown;

  if (typeof rawContent !== "object" || rawContent === null) {
    throw new TypeError("Fragment file must be an object");
  }

  if (!("summary" in rawContent) || typeof rawContent.summary !== "string") {
    throw new TypeError("Fragment file summary must be a string");
  }
  if (!("sentences" in rawContent) || !Array.isArray(rawContent.sentences)) {
    throw new TypeError("Fragment file sentences must be an array");
  }

  return {
    sentences: rawContent.sentences.map(parseSentenceRecord),
    summary: rawContent.summary,
  };
}

async function readFragmentFileContent(
  fragmentPath: string,
  fileAccess: FragmentFileAccess,
): Promise<Uint8Array | undefined> {
  if (fileAccess.listFileContents === undefined) {
    return await fileAccess.readFile(fragmentPath);
  }

  const directoryPath = resolve(join(fragmentPath, ".."));
  const fileName = fragmentPath.slice(directoryPath.length + 1);

  return (await fileAccess.listFileContents(directoryPath)).get(fileName);
}

function parseSentenceRecord(value: unknown): SentenceRecord {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Sentence entry must be an object");
  }

  const { text, wordsCount } = value as {
    readonly text?: unknown;
    readonly wordsCount?: unknown;
  };

  if (typeof text !== "string" || typeof wordsCount !== "number") {
    throw new TypeError("Sentence entry is invalid");
  }

  return {
    text,
    wordsCount,
  };
}
