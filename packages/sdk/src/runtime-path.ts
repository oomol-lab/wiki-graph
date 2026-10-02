import { homedir } from "os";
import { isAbsolute, resolve } from "path";

import { getWikiGraphSDKRuntimeContext } from "./runtime-context.js";

export function resolveWikiGraphRuntimePath(path: string): string {
  const context = getWikiGraphSDKRuntimeContext();
  const environmentHome = context.env.HOME?.trim();
  const home =
    environmentHome === undefined || environmentHome === ""
      ? homedir()
      : environmentHome;
  if (path === "~") return home;
  if (path.startsWith("~/")) return resolve(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(context.cwd, path);
}
