import {
  ensureRelativeDirectory,
  getRelativeDirectory,
  getRelativeFile,
  getWikiGraphStorage,
  resolveHostFile,
  type File,
} from "../../../runtime/platform/index.js";
import { createPortableHash, randomUuid } from "../../../utils/crypto.js";

const WORK_ROOT = ".wikg-work";

export async function createWorkspaceSnapshot(
  archiveKey: string,
  entryPath: string,
): Promise<{ readonly file: File; readonly relativePath: string }> {
  const entryKey = createPortableHash("sha256").update(entryPath).digest("hex");
  const directoryPath = `${WORK_ROOT}/${archiveKey}/${entryKey}`;
  const directory = await ensureRelativeDirectory(
    getWikiGraphStorage().documentStore,
    directoryPath,
  );
  const name = `${randomUuid()}.snapshot`;
  return {
    file: await directory.createFile(name),
    relativePath: `${directoryPath}/${name}`,
  };
}

export async function resolveWorkspaceSnapshot(
  identity: string | undefined,
  relativePath?: string,
): Promise<File | undefined> {
  if (relativePath !== undefined) {
    const managed = await getRelativeFile(
      getWikiGraphStorage().documentStore,
      relativePath,
    );
    if (managed !== undefined) return managed;
  }
  if (identity === undefined) return undefined;
  try {
    return await resolveHostFile(identity);
  } catch {
    return undefined;
  }
}

export async function removeWorkspaceSnapshot(
  relativePath: string | undefined,
): Promise<void> {
  if (relativePath === undefined) return;
  const parts = relativePath.split("/").filter(Boolean);
  const name = parts.pop();
  if (name === undefined) return;
  const root = getWikiGraphStorage().documentStore;
  const parent = await getRelativeDirectory(root, parts.join("/"));
  await parent?.remove(name).catch(() => undefined);
  await removeEmptyParents(parts);
}

async function removeEmptyParents(parts: string[]): Promise<void> {
  const root = getWikiGraphStorage().documentStore;
  for (let index = parts.length; index > 0; index -= 1) {
    const parentParts = parts.slice(0, index - 1);
    const name = parts[index - 1];
    if (name === undefined) continue;
    const parent =
      parentParts.length === 0
        ? root
        : await getRelativeDirectory(root, parentParts.join("/"));
    const directory = await parent?.getDirectory(name);
    if (directory === undefined || (await directory.list()).length > 0) break;
    await parent?.remove(name, { recursive: true }).catch(() => undefined);
  }
}
