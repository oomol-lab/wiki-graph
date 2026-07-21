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
    throw new Error(
      `Chapter ${serialId} summary is missing. Run \`wg wikg://local/job add --input <chapter-uri> --task reading-summary --accept-cost\` before export, or inspect the chapter with \`wg <archive-uri>/chapter/${serialId}/source get\`.`,
    );
  }

  return new Serial(document, serialId, summary);
}
