import { readFileSync } from "fs";
import { dirname, join } from "path";

import { resolveDataDirPath } from "wiki-graph-core";

export function readCLIVersion(): string {
  const packageJSONPath = join(dirname(resolveDataDirPath()), "package.json");
  const parsed: unknown = JSON.parse(readFileSync(packageJSONPath, "utf8"));

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }

  throw new Error(`Invalid package version in ${packageJSONPath}`);
}
