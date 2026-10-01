import { resolve } from "path";

import {
  parseWikiGraphLibraryUri,
  upgradeWikiGraphMaintenanceTarget,
  type WikiGraphMaintenanceUpgradeResult,
} from "wiki-graph-core";

import type { WikiGraphJobRuntime } from "./jobs.js";
import { NodeFile } from "./node-platform.js";
import { getWikiGraphSDKRuntimeContext } from "./runtime-context.js";

export type WikiGraphMaintenanceTarget =
  | { readonly kind: "archive"; readonly path: string }
  | { readonly kind: "home" }
  | { readonly kind: "library"; readonly uri: string };

export class WikiGraphMaintenanceManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async upgrade(
    target: WikiGraphMaintenanceTarget,
  ): Promise<WikiGraphMaintenanceUpgradeResult> {
    return await this.#runtime.run(async () => {
      if (target.kind === "home") {
        return await upgradeWikiGraphMaintenanceTarget({ kind: "home" });
      }
      if (target.kind === "library") {
        const parsed = parseWikiGraphLibraryUri(target.uri);
        if (parsed === undefined || parsed.kind === "archive") {
          throw new Error(
            `Invalid Wiki Graph library upgrade target: ${target.uri}`,
          );
        }
        return await upgradeWikiGraphMaintenanceTarget({
          kind: "library",
          target: parsed,
        });
      }
      const path = resolve(getWikiGraphSDKRuntimeContext().cwd, target.path);
      return await upgradeWikiGraphMaintenanceTarget({
        file: new NodeFile(path),
        kind: "archive",
      });
    });
  }
}
