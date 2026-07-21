import { readFile, readdir } from "fs/promises";
import { join } from "path";

import { isNodeError } from "../../../../../utils/node-error.js";
import type { LegacyFragmentFile, LegacyFragmentRecord } from "./types.js";

export async function listLegacySourceSerials(
  workspacePath: string,
): Promise<readonly number[]> {
  const fragmentsDirectory = join(workspacePath, "fragments");

  try {
    const entries = await readdir(fragmentsDirectory, { withFileTypes: true });
    const serialIds: number[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const match = /^serial-(\d+)$/u.exec(entry.name);

      if (match !== null) {
        serialIds.push(Number(match[1]));
      }
    }

    return serialIds.sort((left, right) => left - right);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function readLegacySourceFragments(
  workspacePath: string,
  serialId: number,
): Promise<readonly LegacyFragmentRecord[]> {
  const serialDirectory = join(
    workspacePath,
    "fragments",
    `serial-${serialId}`,
  );
  const entries = await readdir(serialDirectory, { withFileTypes: true });
  const records: LegacyFragmentRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = /^fragment_(\d+)\.json$/u.exec(entry.name);

    if (match === null) {
      continue;
    }

    const path = join(serialDirectory, entry.name);
    const content = parseLegacyFragmentFile(await readFile(path, "utf8"));

    records.push({
      content,
      fragmentId: Number(match[1]),
      path,
      signature: createLegacyFragmentSignature(content),
    });
  }

  return records.sort((left, right) => left.fragmentId - right.fragmentId);
}

function parseLegacyFragmentFile(content: string): LegacyFragmentFile {
  const parsed = JSON.parse(content) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }

  const rawFragment = parsed as Record<string, unknown>;

  if (!Array.isArray(rawFragment.sentences)) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }

  const sentences = rawFragment.sentences.map((sentence) => {
    if (
      typeof sentence !== "object" ||
      sentence === null ||
      !("text" in sentence) ||
      typeof (sentence as Record<string, unknown>).text !== "string"
    ) {
      throw new TypeError("Legacy fragment sentence must contain text.");
    }

    const rawSentence = sentence as Record<string, unknown>;
    const text = rawSentence.text as string;
    const rawWordsCount = rawSentence.wordsCount;
    const wordsCount =
      typeof rawWordsCount === "number" ? rawWordsCount : countWords(text);

    return {
      text,
      wordsCount,
    };
  });
  const summary =
    typeof rawFragment.summary === "string" ? rawFragment.summary : "";

  return { sentences, summary };
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function createLegacyFragmentSignature(fragment: LegacyFragmentFile): string {
  return JSON.stringify(fragment.sentences.map((sentence) => sentence.text));
}

export function createDuplicateHalfCanonicalizationPlan(
  fragments: readonly LegacyFragmentRecord[],
):
  | {
      readonly canonicalFragments: readonly LegacyFragmentRecord[];
      readonly fragmentIdMap: ReadonlyMap<number, number>;
    }
  | undefined {
  if (fragments.length < 2 || fragments.length % 2 !== 0) {
    return undefined;
  }

  const halfLength = fragments.length / 2;
  const leftHalf = fragments.slice(0, halfLength);
  const rightHalf = fragments.slice(halfLength);

  for (let index = 0; index < halfLength; index += 1) {
    if (leftHalf[index]?.signature !== rightHalf[index]?.signature) {
      return undefined;
    }
  }

  const preferRightHalf = rightHalf.some(
    (fragment) => fragment.content.summary.trim() !== "",
  );
  const sourceFragments = preferRightHalf ? rightHalf : leftHalf;
  const fragmentIdMap = new Map<number, number>();
  const canonicalFragments = sourceFragments.map((fragment, index) => {
    const leftFragment = leftHalf[index];
    const rightFragment = rightHalf[index];

    if (leftFragment !== undefined) {
      fragmentIdMap.set(leftFragment.fragmentId, index);
    }
    if (rightFragment !== undefined) {
      fragmentIdMap.set(rightFragment.fragmentId, index);
    }

    return {
      ...fragment,
      fragmentId: index,
    };
  });

  return { canonicalFragments, fragmentIdMap };
}
