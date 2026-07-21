import { readFile, writeFile } from "fs/promises";

import {
  summaryInputSnapshotSchema,
  toChunkRecord,
  toReadingEdgeRecord,
} from "./schema.js";
import type { SummaryInputSnapshotData } from "./types.js";

export async function readSummaryInputSnapshot(
  filePath: string,
): Promise<SummaryInputSnapshotData> {
  const snapshot = summaryInputSnapshotSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );

  return {
    ...snapshot,
    chunks: snapshot.chunks.map(toChunkRecord),
    readingEdges: snapshot.readingEdges.map(toReadingEdgeRecord),
  };
}

export async function writeSummaryInputSnapshot(
  filePath: string,
  snapshot: SummaryInputSnapshotData,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
}
