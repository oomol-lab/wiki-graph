import { renderArchiveMaintenanceChapterActionHelpText, renderArchiveMaintenanceCommandHelpText } from "../../help.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import type { ArchiveArgumentValues, CLIArchiveMaintenanceCommand, ParsedCLIArguments } from "../types.js";
import { isArchiveChapterAction } from "../helpers.js";

export function parseArchiveMaintenanceArguments(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  if (values.help !== true) {
    throw new Error(
      withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command),
    );
  }

  switch (command) {
    case "cover":
    case "meta":
      if (positionals.length > 0) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceCommandHelpText(command),
        kind: "maintenance",
      };
    case "chapter": {
      const action = positionals[0];
      if (action === undefined) {
        return {
          help: true,
          helpText: renderArchiveMaintenanceCommandHelpText("chapter"),
          kind: "chapter",
        };
      }
      if (!isArchiveChapterAction(action)) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Use the chapter collection URI directly, add --query, or use add, move, remove, reset, or tree. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (
        action === "set-source" ||
        action === "set-summary" ||
        action === "set-title"
      ) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (positionals.length > 1) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceChapterActionHelpText(action),
        kind: "chapter",
      };
    }
  }
}
