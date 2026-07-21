import { mkdir, readFile, readdir, writeFile } from "fs/promises";

import { isNodeError } from "../../utils/node-error.js";
import type { FragmentFileAccess, FragmentWriter } from "./types.js";

export const DEFAULT_FRAGMENT_WRITER: FragmentWriter = {
  write: async (path, content) => {
    await writeFile(path, content, "utf8");
  },
};

export const DEFAULT_FRAGMENT_FILE_ACCESS: FragmentFileAccess = {
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  listFiles: async (path) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readFile: async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  },
};
