import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  getRelativeDirectory,
  getRelativeFile,
  isDirectory,
  readFileBytes,
  writeFileContent,
  type Directory,
} from "../../runtime/platform/index.js";
import { dirnameRelativePath } from "../../utils/relative-path.js";
import type { FragmentFileAccess, FragmentWriter } from "./types.js";

export function createDirectoryFragmentAccess(root: Directory): {
  readonly fileAccess: FragmentFileAccess;
  readonly writer: FragmentWriter;
} {
  return {
    fileAccess: {
      ensureDirectory: async (path) => {
        await ensureRelativeDirectory(root, path);
      },
      listFiles: async (path) => {
        const directory = await getRelativeDirectory(root, path);
        if (directory === undefined) return [];
        return (await directory.list())
          .filter((entry) => !isDirectory(entry))
          .map((entry) => entry.name);
      },
      readFile: async (path) => {
        const file = await getRelativeFile(root, path);
        if (file === undefined) return undefined;
        return await readFileBytes(file);
      },
    },
    writer: {
      write: async (path, content) => {
        await ensureRelativeDirectory(root, dirnameRelativePath(path));
        await writeFileContent(await ensureRelativeFile(root, path), content);
      },
    },
  };
}

function unavailable(): never {
  throw new Error("Fragment storage requires a host Directory adapter.");
}

export const DEFAULT_FRAGMENT_WRITER: FragmentWriter = {
  write: async () => unavailable(),
};

export const DEFAULT_FRAGMENT_FILE_ACCESS: FragmentFileAccess = {
  ensureDirectory: async () => unavailable(),
  listFiles: async () => unavailable(),
  readFile: async () => unavailable(),
};
