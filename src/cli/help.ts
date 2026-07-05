import { resolveDataDirPath } from "../common/data-dir.js";
import { createEnv } from "../common/template.js";

import { CLI_FORMATS } from "./formats.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import type {
  CLIArchiveAction,
  CLIArchiveChapterAction,
  CLIArchiveMaintenanceCommand,
} from "./args.js";

export const HELP_TOPICS = [
  "format",
  "config",
  "runtime",
  "uri",
  "recipe",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export type UriHelpTargetName =
  | "archive-scope"
  | "chapter-collection-scope"
  | "chapter-scope"
  | "chapter-source-object"
  | "chapter-summary-object"
  | "chapter-title-object"
  | "chapter-tree-object"
  | "chapter-state-object"
  | "chunk-scope"
  | "chunk-object"
  | "cover-object"
  | "entity-scope"
  | "entity-object"
  | "entity-wikipage-object"
  | "index-object"
  | "job-collection-scope"
  | "job-object"
  | "job-target-object"
  | "local-config-section"
  | "summary-object"
  | "triple-scope"
  | "triple-object";

export type UriHelpPredicateName =
  | "add"
  | "boost"
  | "build"
  | "cancel"
  | "clear"
  | "clean"
  | "create"
  | "delete"
  | "embed"
  | "evidence"
  | "export"
  | "external"
  | "inspect"
  | "move"
  | "pack"
  | "pause"
  | "put"
  | "related"
  | "remove"
  | "reset"
  | "resume"
  | "set"
  | "test"
  | "watch";

interface UriHelpTarget {
  readonly name: UriHelpTargetName;
  readonly predicates: readonly UriHelpPredicateName[];
}

const URI_HELP_TARGETS: readonly UriHelpTarget[] = [
  {
    name: "archive-scope",
    predicates: ["create", "export", "inspect", "set"],
  },
  { name: "chapter-collection-scope", predicates: ["add"] },
  {
    name: "chapter-scope",
    predicates: ["inspect", "move", "remove", "reset"],
  },
  { name: "chapter-source-object", predicates: ["set"] },
  { name: "chapter-summary-object", predicates: ["evidence", "set"] },
  { name: "chapter-title-object", predicates: ["clear", "set"] },
  { name: "chapter-tree-object", predicates: ["set"] },
  { name: "chapter-state-object", predicates: [] },
  { name: "chunk-scope", predicates: [] },
  { name: "chunk-object", predicates: ["evidence", "pack", "related"] },
  { name: "cover-object", predicates: [] },
  {
    name: "entity-scope",
    predicates: [],
  },
  { name: "entity-object", predicates: ["evidence", "pack", "related"] },
  { name: "entity-wikipage-object", predicates: [] },
  { name: "index-object", predicates: ["build", "clear", "embed", "external"] },
  {
    name: "job-collection-scope",
    predicates: ["add", "clean"],
  },
  {
    name: "job-object",
    predicates: ["boost", "cancel", "pause", "resume", "watch"],
  },
  { name: "job-target-object", predicates: ["set"] },
  {
    name: "local-config-section",
    predicates: ["clear", "delete", "put", "set", "test"],
  },
  { name: "summary-object", predicates: ["evidence"] },
  { name: "triple-scope", predicates: [] },
  { name: "triple-object", predicates: ["evidence"] },
] as const;

const URI_HELP_TARGET_LOOKUP = new Map<UriHelpTargetName, UriHelpTarget>(
  URI_HELP_TARGETS.map((target) => [target.name, target]),
);

export const ARCHIVE_COMMANDS = [
  "create",
  "related",
  "evidence",
  "next",
  "pack",
  "inspect",
  "export",
] as const satisfies readonly CLIArchiveAction[];

export const ARCHIVE_MAINTENANCE_COMMANDS = [
  "cover",
  "meta",
  "chapter",
] as const satisfies readonly CLIArchiveMaintenanceCommand[];

const HELP_TOPIC_METADATA: readonly {
  readonly name: HelpTopic;
  readonly summary: string;
}[] = [
  {
    name: "format",
    summary: "Supported formats, inference rules, and IO constraints.",
  },
  {
    name: "config",
    summary: "Configuration overview, precedence, and when each layer applies.",
  },
  {
    name: "runtime",
    summary: "Advanced runtime, worker, cache, log, JSONL, and debug behavior.",
  },
  {
    name: "uri",
    summary:
      "URI grammar, command routing, scopes, objects, and retrieval strategy.",
  },
  {
    name: "recipe",
    summary: "Recommended workflow and best practices after root help.",
  },
] as const;

const ARCHIVE_MAINTENANCE_COMMAND_METADATA: readonly {
  readonly name: CLIArchiveMaintenanceCommand;
  readonly summary: string;
}[] = [
  {
    name: "cover",
    summary: "Write raw cover bytes to stdout for redirection or piping.",
  },
  {
    name: "meta",
    summary: "Read or edit metadata attached to an object.",
  },
  {
    name: "chapter",
    summary: "Edit the chapter tree and per-chapter digest stages.",
  },
] as const;

const HELP_TOPIC_TEMPLATE_NAMES: Readonly<Record<HelpTopic, string>> = {
  format: "help/topics/format",
  config: "help/topics/config",
  runtime: "help/topics/runtime",
  uri: "help/topics/uri",
  recipe: "help/topics/recipe",
};

let helpTemplateEnvironment: ReturnType<typeof createEnv> | undefined;

export function renderMainHelpText(): string {
  return renderHelpTemplate("help/commands/root");
}

export function renderTransformHelpText(): string {
  return renderHelpTemplate("help/commands/transform");
}

export function renderGcCommandHelpText(): string {
  return renderHelpTemplate("help/commands/gc");
}

export function renderLegacyCommandHelpText(action?: "migrate"): string {
  return renderHelpTemplate(
    action === undefined
      ? "help/commands/legacy"
      : `help/commands/legacy/${action}`,
  );
}

export function renderArchiveCommandHelpText(action: CLIArchiveAction): string {
  return renderHelpTemplate(`help/commands/archive/${action}`);
}

export function renderHelpTopicText(topic: HelpTopic): string {
  return renderHelpTemplate(HELP_TOPIC_TEMPLATE_NAMES[topic]);
}

export function renderUriHelpText(
  targetName: UriHelpTargetName,
  uri: string,
): string {
  return renderHelpTemplate("help/commands/uri", {
    target: requireUriHelpTarget(targetName),
    uri,
  });
}

export function renderUriPredicateHelpText(
  targetName: UriHelpTargetName,
  predicate: UriHelpPredicateName,
  uri: string,
): string {
  const target = requireUriHelpTarget(targetName);

  if (!target.predicates.includes(predicate)) {
    throw new Error(
      withHelpRoute(
        `The URI target ${uri} does not support \`${predicate}\`.`,
        `wikigraph ${uri} --help`,
      ),
    );
  }

  return renderHelpTemplate("help/commands/predicate", {
    predicate,
    target,
    uri,
  });
}

export function isUriHelpPredicate(
  targetName: UriHelpTargetName,
  predicate: string,
): predicate is UriHelpPredicateName {
  return requireUriHelpTarget(targetName).predicates.includes(
    predicate as UriHelpPredicateName,
  );
}

export function renderArchiveMaintenanceCommandHelpText(
  command: CLIArchiveMaintenanceCommand,
): string {
  return renderHelpTemplate(`help/commands/maintenance/${command}`);
}

export function renderArchiveMaintenanceChapterActionHelpText(
  action: CLIArchiveChapterAction,
): string {
  return renderHelpTemplate(`help/commands/maintenance/chapter/${action}`);
}

export function parseHelpTopic(value: string): HelpTopic {
  const normalized = value.trim().toLowerCase();

  if (HELP_TOPICS.includes(normalized as HelpTopic)) {
    return normalized as HelpTopic;
  }

  throw new Error(
    withHelpRoute(
      `Invalid help topic: ${value}. Expected one of ${HELP_TOPICS.join(", ")}.`,
      CLI_HELP_ROUTES.root,
    ),
  );
}

function requireUriHelpTarget(name: UriHelpTargetName): UriHelpTarget {
  const target = URI_HELP_TARGET_LOOKUP.get(name);

  if (target === undefined) {
    throw new Error(`Internal error: unknown URI help target ${name}.`);
  }

  return target;
}

function renderHelpTemplate(
  templateName: string,
  extraContext: Record<string, unknown> = {},
): string {
  return getHelpTemplateEnvironment().render(templateName, {
    formats: CLI_FORMATS,
    helpTopics: HELP_TOPIC_METADATA,
    archiveMaintenanceCommands: ARCHIVE_MAINTENANCE_COMMAND_METADATA,
    uriHelpTargets: URI_HELP_TARGETS,
    ...extraContext,
  });
}

function getHelpTemplateEnvironment(): ReturnType<typeof createEnv> {
  helpTemplateEnvironment ??= createEnv(resolveDataDirPath(), {
    autoescape: false,
  });

  return helpTemplateEnvironment;
}
