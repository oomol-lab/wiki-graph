import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import type { BuildJobTarget } from "wiki-graph-core";
import type {
  CLIArchiveAction,
  CLIArchiveIndexAction,
  CLIArchiveUriAction,
  CLIJobAction,
  CLIMetadataAction,
} from "./types.js";
import { isArchiveChapterAction } from "./helper-chapter.js";

export function isArchiveAction(
  value: string | undefined,
): value is CLIArchiveAction {
  return (
    value === "create" ||
    value === "evidence" ||
    value === "export" ||
    value === "get" ||
    value === "inspect" ||
    value === "list" ||
    value === "next" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

export function isPublicArchiveCommandHelpAction(
  value: string | undefined,
): value is "next" {
  return value === "next";
}

export function isRemovedImplicitArchiveAction(
  value: string | undefined,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}

export function formatRemovedImplicitVerbMessage(
  _action: "get" | "list" | "search",
): string {
  return withHelpRoute(
    "This command form is not available. Pass the URI directly, or add --query to a scope URI.",
    CLI_HELP_ROUTES.uri,
  );
}

export function isArchiveUriAction(
  value: string | undefined,
): value is CLIArchiveUriAction {
  return (
    isArchiveAction(value) ||
    isArchiveChapterAction(value) ||
    isArchiveIndexAction(value) ||
    isMetadataAction(value)
  );
}

export function isArchiveIndexAction(
  value: string | undefined,
): value is CLIArchiveIndexAction {
  return (
    value === "disable" ||
    value === "embed" ||
    value === "enable" ||
    value === "external" ||
    value === "get"
  );
}

export function isMetadataAction(
  value: string | undefined,
): value is CLIMetadataAction {
  return (
    value === "clear" ||
    value === "delete" ||
    value === "get" ||
    value === "put" ||
    value === "set"
  );
}

export function isUriFirstArchiveAction(
  value: string | undefined,
): value is "evidence" | "get" | "list" | "pack" | "related" | "search" {
  return (
    value === "evidence" ||
    value === "get" ||
    value === "list" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

export function isImplicitArchiveReadAction(
  value: CLIArchiveUriAction,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}
export function isJobUriAction(
  value: string | undefined,
): value is CLIJobAction {
  return (
    value === "add" ||
    value === "boost" ||
    value === "cancel" ||
    value === "clean" ||
    value === "get" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "set" ||
    value === "watch"
  );
}

export function parseBuildJobTarget(value: string | undefined): BuildJobTarget {
  switch (value) {
    case undefined:
    case "reading-summary":
      return "reading-summary";
    case "reading-graph":
      return "reading-graph";
    case "knowledge-graph":
      return "knowledge-graph";
    default:
      throw new Error(
        withHelpRoute(
          `Invalid queue task: ${value}. Expected reading-graph, reading-summary, or knowledge-graph.`,
          "wg wikg://local/job add --help",
        ),
      );
  }
}
