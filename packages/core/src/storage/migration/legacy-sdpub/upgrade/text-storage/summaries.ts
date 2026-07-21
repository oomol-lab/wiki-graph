import { readFile, readdir } from "fs/promises";
import { join } from "path";

import { DirectoryDocument } from "../../../../../document/directory/index.js";
import { isNodeError } from "../../../../../utils/node-error.js";

export async function migrateLegacySummariesToTextStreams(
  workspacePath: string,
): Promise<void> {
  const summaries = await listLegacySummaries(workspacePath);
  const document = await DirectoryDocument.open(workspacePath);

  try {
    for (const summary of summaries) {
      await document.writeSummary(summary.serialId, summary.text);
    }
  } finally {
    await document.release();
  }
}
async function listLegacySummaries(
  workspacePath: string,
): Promise<Array<{ readonly serialId: number; readonly text: string }>> {
  const summaryDirectory = join(workspacePath, "summaries");

  try {
    const entries = await readdir(summaryDirectory, { withFileTypes: true });
    const summaries: Array<{ serialId: number; text: string }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const match = /^serial-(\d+)\.txt$/u.exec(entry.name);

      if (match === null) {
        continue;
      }

      summaries.push({
        serialId: Number(match[1]),
        text: await readFile(join(summaryDirectory, entry.name), "utf8"),
      });
    }

    return summaries.sort((left, right) => left.serialId - right.serialId);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
