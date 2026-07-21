import type { CLIArchiveChapterAction, CLIArchiveMaintenanceCommand } from "../types.js";

export function isArchiveChapterAction(
  value: string | undefined,
): value is CLIArchiveChapterAction {
  return (
    value === "add" ||
    value === "list" ||
    value === "move" ||
    value === "remove" ||
    value === "reset" ||
    value === "set-source" ||
    value === "set-summary" ||
    value === "set-title" ||
    value === "tree"
  );
}

export function isArchiveMaintenanceCommand(
  value: string | undefined,
): value is CLIArchiveMaintenanceCommand {
  return value === "chapter" || value === "cover" || value === "meta";
}
