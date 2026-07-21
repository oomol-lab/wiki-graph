import type { Document } from "../../document/index.js";
import type { ReaderTextStream } from "../reader/index.js";
import { collectTextStream } from "./fragments.js";
import type { WriteSerialSourceOptions } from "./options.js";

export async function writeSerialSource(
  document: Document,
  serialId: number,
  stream: ReaderTextStream,
  options: WriteSerialSourceOptions = {},
): Promise<void> {
  const serialFragments = document.getSerialFragments(serialId);

  await serialFragments.writeTextStream(await collectTextStream(stream), {
    ...(options.segmenter === undefined
      ? {}
      : { segmenter: options.segmenter }),
  });
  await document.serials.bumpRevision(serialId);
}
