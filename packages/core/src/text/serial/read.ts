import type { ReadonlyDocument } from "../../document/index.js";
import { getSerialRecord } from "./record.js";
import { Serial } from "./topology.js";

export async function readSerial(
  document: ReadonlyDocument,
  serialId: number,
): Promise<Serial> {
  const record = await getSerialRecord(document, serialId);

  if (!record.topologyReady) {
    throw new Error(`Serial ${serialId} is not ready`);
  }

  const summary = await document.readSummary(serialId);

  if (summary === undefined) {
    throw new WikiGraphError(
      "chapter_summary_missing_source",
      `Chapter ${serialId} summary is missing.`,
      { chapterId: serialId },
    );
  }

  return new Serial(document, serialId, summary);
}
import { WikiGraphError } from "../../runtime/common/error.js";
