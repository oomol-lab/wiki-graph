import {
  parseWikiGraphLibraryUri,
  upgradeWikiGraphMaintenanceTarget,
  type WikiGraphMaintenanceUpgradeResult,
} from "wiki-graph-sdk";

import type { CLIMaintenanceArguments } from "../args/index.js";
import { isWikiGraphHomeTarget } from "../runtime/home-target.js";
import { formatCLIJSON, writeTextToStdout } from "../support/index.js";
import { NodeFile } from "../runtime/node-platform.js";
import { resolve } from "path";

export async function runMaintenanceCommand(
  args: CLIMaintenanceArguments,
): Promise<void> {
  switch (args.action) {
    case "upgrade": {
      if (args.outputPath !== undefined || args.target.endsWith(".sdpub")) {
        throw new Error(
          "Legacy sdpub migration is available through `wg legacy migrate`.",
        );
      }
      const result = await upgradeWikiGraphMaintenanceTarget(
        parseMaintenanceTarget(args.target),
      );
      await writeTextToStdout(
        args.json === true
          ? formatCLIJSON(result)
          : formatMaintenanceUpgradeResult(result),
      );
      return;
    }
  }
}

function formatMaintenanceUpgradeResult(
  result: WikiGraphMaintenanceUpgradeResult,
): string {
  switch (result.kind) {
    case "home":
      return `Home ${result.status} (schema v${result.schemaVersionBefore} -> v${result.schemaVersionAfter})\n`;
    case "archive":
      return `Archive ${result.status}: ${result.fileName} (schema v${result.schemaVersionBefore} -> v${result.schemaVersionAfter})\n`;
    case "lib": {
      const lines = [
        `Library ${result.status}: ${result.library.uri}`,
        `upgraded: ${result.upgraded.length}`,
        `already current: ${result.skipped.length}`,
      ];
      if (result.failed !== undefined) {
        lines.push(`failed: ${result.failed.uri} (${result.failed.message})`);
      }
      return `${lines.join("\n")}\n`;
    }
  }
}

function parseMaintenanceTarget(target: string) {
  if (isWikiGraphHomeTarget(target)) {
    return { kind: "home" as const };
  }
  if (target.startsWith("wikg://lib")) {
    const parsed = parseWikiGraphLibraryUri(target);
    if (parsed === undefined || parsed.kind === "archive") {
      throw new Error(`Invalid Wiki Graph library upgrade target: ${target}`);
    }
    return { kind: "library" as const, target: parsed };
  }
  if (!target.endsWith(".wikg")) {
    throw new Error(`Unsupported maintenance upgrade target: ${target}`);
  }
  return { file: new NodeFile(resolve(target)), kind: "archive" as const };
}
