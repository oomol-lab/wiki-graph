import type { ReadonlyDocument } from "../../../document/index.js";
import { isMissingSearchIndexError } from "./errors.js";
import {
  createSearchIndexFingerprint,
  readSearchIndexFingerprintFromDatabase,
} from "./fingerprint.js";
import type { SearchIndexInput, SearchIndexStatus } from "./types.js";

export async function isSearchIndexCurrent(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<boolean> {
  return (await readSearchIndexStatus(document, input)) === "current";
}

export async function readSearchIndexStatus(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<SearchIndexStatus> {
  const fingerprint =
    input === undefined ? undefined : createSearchIndexFingerprint(input);

  try {
    return await document.readSearchIndexDatabase(async (database) => {
      const indexedFingerprint =
        await readSearchIndexFingerprintFromDatabase(database);

      if (indexedFingerprint === undefined) {
        return "dirty";
      }

      return fingerprint === undefined || indexedFingerprint === fingerprint
        ? "current"
        : "dirty";
    });
  } catch (error) {
    if (isMissingSearchIndexError(error)) {
      return "missing";
    }

    throw error;
  }
}
