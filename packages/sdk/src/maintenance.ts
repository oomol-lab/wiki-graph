import {
  migrateLegacySdpubToWikg,
  parseWikiGraphLibraryUri,
  upgradeWikiGraphMaintenanceTarget,
  type WikiGraphMaintenanceUpgradeResult,
} from "wiki-graph-core";
import { basename } from "path";

import type { WikiGraphJobRuntime } from "./jobs.js";
import { NodeFile } from "./node-platform.js";
import { resolveWikiGraphRuntimePath } from "./runtime-path.js";
import { assertStandaloneWikiGraphArchivePath } from "./archive/target.js";

export type WikiGraphMaintenanceTarget =
  | { readonly kind: "archive"; readonly path: string }
  | { readonly kind: "home" }
  | { readonly kind: "library"; readonly uri: string };

export interface WikiGraphLegacyMigrationResult {
  readonly inputPath: string;
  readonly outputPath: string;
}

export class WikiGraphMaintenanceManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async upgrade(
    target: WikiGraphMaintenanceTarget,
  ): Promise<WikiGraphMaintenanceUpgradeResult> {
    return await this.#runtime.run(
      async () => {
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
        const path = await assertStandaloneWikiGraphArchivePath(target.path);
        return await upgradeWikiGraphMaintenanceTarget({
          file: new NodeFile(path),
          kind: "archive",
        });
      },
      undefined,
      { skipHomeBootstrap: target.kind === "home" },
    );
  }

  public async migrateLegacy(
    inputPath: string,
    outputPath = defaultWikgOutputPath(inputPath),
  ): Promise<WikiGraphLegacyMigrationResult> {
    return await this.#runtime.run(async () => {
      const resolvedInputPath = resolveWikiGraphRuntimePath(inputPath);
      const resolvedOutputPath = resolveWikiGraphRuntimePath(outputPath);
      await migrateLegacySdpubToWikg(
        new NodeFile(resolvedInputPath),
        new NodeFile(resolvedOutputPath, basename(resolvedOutputPath)),
      );
      return {
        inputPath: resolvedInputPath,
        outputPath: resolvedOutputPath,
      };
    });
  }
}

function defaultWikgOutputPath(inputPath: string): string {
  return inputPath.toLowerCase().endsWith(".sdpub")
    ? `${inputPath.slice(0, -".sdpub".length)}.wikg`
    : `${inputPath}.wikg`;
}
