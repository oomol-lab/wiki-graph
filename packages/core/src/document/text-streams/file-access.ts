import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";

import { isNodeError } from "../../utils/node-error.js";
import type { TextStreamFileAccess } from "./types.js";

export const DEFAULT_FILE_ACCESS: TextStreamFileAccess = {
  deleteTree: async (path) => {
    await rm(path, { force: true, recursive: true });
  },
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
  writeFile: async (path, content, options) => {
    await writeFile(path, content, {
      ...(typeof content === "string" ? { encoding: "utf8" as const } : {}),
      flag: options.overwrite === true ? "w" : "wx",
    });
  },
};
