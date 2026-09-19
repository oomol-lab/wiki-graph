import {
  ensureRelativeDirectory,
  readHostZipEntries,
  resolveHostDirectory,
  resolveHostReadonlyFile,
  type Directory,
  type ReadonlyFile,
} from "../../../runtime/platform/index.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";
import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import { parseWikgManifest, parseWikgMutationToken } from "./manifest.js";

export async function extractWikgArchive(
  inputFileRef: ReadonlyFile | string,
  outputDirectoryRef: Directory | string,
): Promise<void> {
  const inputFile = await resolveHostReadonlyFile(inputFileRef);
  const outputDirectory = await resolveHostDirectory(outputDirectoryRef);
  const archiveEntries = await readHostZipEntries(inputFile);
  const entries = new Map(
    archiveEntries.map((entry) => [
      normalizeArchivePath(entry.name),
      entry.data,
    ]),
  );
  const mutationToken = entries.get(WIKG_MUTATION_TOKEN_PATH);
  if (mutationToken === undefined) {
    throw new Error(
      `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
    );
  }
  parseWikgMutationToken(new TextDecoder().decode(mutationToken));
  const manifest = entries.get(WIKG_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  parseWikgManifest(new TextDecoder().decode(manifest));

  for (const entry of archiveEntries) {
    const name = normalizeArchivePath(entry.name);
    if (name === "")
      throw new Error(`Invalid archive entry path: ${entry.name}`);
    if (!isWikgArchivePath(name)) continue;
    const parts = name.split("/");
    const fileName = parts.pop();
    if (!fileName) continue;
    const parent = await ensureRelativeDirectory(
      outputDirectory,
      parts.join("/"),
    );
    const file =
      (await parent.getFile(fileName)) ?? (await parent.createFile(fileName));
    const writer = await file.openWriter();
    try {
      await writer.write(entry.data);
      await writer.commit();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
  }
}
