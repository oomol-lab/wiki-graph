import { existsSync, readFileSync, rmSync, unlinkSync } from "fs";
import { join } from "path";

const binNames = ["wg", "wikigraph"];
const localGlobalDirName = ".wiki-graph-local-global";

function isOwnedBinShim(binPath) {
  if (!existsSync(binPath)) {
    return false;
  }

  try {
    return readFileSync(binPath, "utf8").includes(localGlobalDirName);
  } catch {
    return false;
  }
}

export function getLocalGlobalDir(globalBinDir) {
  return join(globalBinDir, localGlobalDirName);
}

export function removeLocalInstallState(globalBinDir) {
  for (const binName of binNames) {
    const binPath = join(globalBinDir, binName);

    if (isOwnedBinShim(binPath)) {
      unlinkSync(binPath);
    }
  }

  rmSync(getLocalGlobalDir(globalBinDir), { force: true, recursive: true });
}
