import { getWikiGraphSDK } from "../../../runtime/context.js";
import type { ArchiveOutputContext } from "./types.js";

export async function createOutputContinuationCursor(
  context: ArchiveOutputContext,
  cursor: string | null | undefined,
): Promise<string | null> {
  if (context.continuationCursorIsDurable === true) return cursor ?? null;
  return await getWikiGraphSDK().continuations.create(context, cursor);
}
