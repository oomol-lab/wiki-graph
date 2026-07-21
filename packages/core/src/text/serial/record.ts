import type {
  Document,
  ReadonlyDocument,
  SerialRecord,
} from "../../document/index.js";
import type { SerialGenerationOptions } from "./options.js";

export function resolveDocument(options: SerialGenerationOptions): Document {
  const document = options.document ?? options.workspace;

  if (document === undefined) {
    throw new Error("SerialGeneration requires a document");
  }

  return document;
}

export async function getSerialRecord(
  document: Pick<ReadonlyDocument, "serials">,
  serialId: number,
): Promise<SerialRecord> {
  const record = await document.serials.getById(serialId);

  if (record === undefined) {
    throw new Error(
      `Chapter ${serialId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
    );
  }

  return record;
}
