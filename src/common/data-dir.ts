import { existsSync, statSync } from "fs";
import { dirname, join, parse } from "path";

export function resolveDataDirPath(): string {
  const injectedPath = (globalThis as { __WIKIGRAPH_DATA_DIR__?: unknown })
    .__WIKIGRAPH_DATA_DIR__;

  if (typeof injectedPath === "string" && injectedPath !== "") {
    return injectedPath;
  }

  return resolveDataDirPathFromWorkingDirectory();
}

function resolveDataDirPathFromWorkingDirectory(): string {
  let currentDirectoryPath = process.cwd();
  const rootDirectoryPath = parse(currentDirectoryPath).root;

  while (true) {
    const candidatePath = join(currentDirectoryPath, "data");

    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      return candidatePath;
    }

    if (currentDirectoryPath === rootDirectoryPath) {
      throw new Error("Could not locate data directory");
    }

    currentDirectoryPath = dirname(currentDirectoryPath);
  }
}
