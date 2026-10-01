import type {
  WikiGraphMaintenanceTarget,
  WikiGraphMaintenanceUpgradeResult,
} from "wiki-graph-sdk";

import type { CLIMaintenanceArguments } from "../args/index.js";
import { isWikiGraphHomeTarget } from "../runtime/home-target.js";
import { getWikiGraphSDK } from "../runtime/context.js";
import { formatCLIJSON, writeTextToStdout } from "../support/index.js";

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
      const result = await getWikiGraphSDK().maintenance.upgrade(
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

function parseMaintenanceTarget(target: string): WikiGraphMaintenanceTarget {
  if (isWikiGraphHomeTarget(target)) {
    return { kind: "home" as const };
  }
  if (target.startsWith("wikg://lib")) {
    return { kind: "library", uri: target };
  }
  if (!target.endsWith(".wikg")) {
    throw new Error(`Unsupported maintenance upgrade target: ${target}`);
  }
  return { kind: "archive", path: target };
}
