import {
  createNodeTemplateEnvironment,
  formatWikiGraphLibraryUri,
  parseWikiGraphLibraryUri,
} from "wiki-graph-sdk";
import { existsSync } from "fs";
import { dirname, join, parse, resolve } from "path";

import { CLI_FULL_COMMAND, CLI_PRIMARY_COMMAND } from "../support/command.js";
import { getCLIDevProjectRoot } from "../runtime/context.js";
import type { ParsedWikiGraphLibraryUri } from "wiki-graph-sdk";
import { CLI_FORMATS, parseLocatedWikiGraphUri } from "../support/index.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { formatCliCommand, formatShellArgument } from "../support/index.js";
import type {
  CLIArchiveAction,
  CLIArchiveChapterAction,
  CLIArchiveMaintenanceCommand,
  CLILibraryAction,
} from "./types.js";
import { parseChapterTarget } from "./uri/chapter/target.js";

export const HELP_TOPICS = [
  "format",
  "file-import",
  "source-locators",
  "config",
  "runtime",
  "uri",
  "recipe",
  "readiness",
  "library",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export type UriHelpTargetName =
  | "archive-scope"
  | "artifact-object"
  | "chapter-collection-scope"
  | "chapter-scope"
  | "chapter-source-range-object"
  | "chapter-source-locator-scope"
  | "chapter-source-object"
  | "chapter-summary-range-object"
  | "chapter-summary-object"
  | "chapter-title-object"
  | "chapter-tree-object"
  | "chapter-state-object"
  | "chapter-index-artifact"
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
  | "local-config-namespace"
  | "local-config-section"
  | "metadata-object"
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
  | "evidence"
  | "export"
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
  | "sync"
  | "test"
  | "watch";

export type LibraryHelpPredicateName = CLILibraryAction | "clean" | "sync";

interface UriHelpTarget {
  readonly name: UriHelpTargetName;
  readonly predicates: readonly UriHelpPredicateName[];
}

const URI_HELP_TARGETS: readonly UriHelpTarget[] = [
  {
    name: "archive-scope",
    predicates: ["create", "export", "inspect"],
  },
  { name: "artifact-object", predicates: [] },
  {
    name: "chapter-collection-scope",
    predicates: ["add"],
  },
  {
    name: "chapter-scope",
    predicates: ["move", "remove", "reset"],
  },
  { name: "chapter-source-range-object", predicates: [] },
  { name: "chapter-source-locator-scope", predicates: [] },
  { name: "chapter-source-object", predicates: ["set"] },
  { name: "chapter-summary-range-object", predicates: [] },
  { name: "chapter-summary-object", predicates: ["set"] },
  { name: "chapter-title-object", predicates: ["clear", "set"] },
  { name: "chapter-tree-object", predicates: ["set"] },
  { name: "chapter-state-object", predicates: [] },
  { name: "chapter-index-artifact", predicates: ["build", "delete"] },
  { name: "chunk-scope", predicates: [] },
  { name: "chunk-object", predicates: ["evidence", "pack", "related"] },
  { name: "cover-object", predicates: [] },
  {
    name: "entity-scope",
    predicates: [],
  },
  { name: "entity-object", predicates: ["evidence", "pack", "related"] },
  { name: "entity-wikipage-object", predicates: [] },
  {
    name: "index-object",
    predicates: ["clean", "sync"],
  },
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
    name: "local-config-namespace",
    predicates: [],
  },
  {
    name: "local-config-section",
    predicates: ["clear", "delete", "put", "set", "test"],
  },
  {
    name: "metadata-object",
    predicates: ["clear", "delete", "put", "set"],
  },
  { name: "summary-object", predicates: [] },
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
  readonly rootVisible?: boolean;
}[] = [
  {
    name: "format",
    summary: "Supported formats, inference rules, and IO constraints.",
  },
  {
    name: "file-import",
    rootVisible: false,
    summary: "Advanced source-file import and source-text provenance behavior.",
  },
  {
    name: "source-locators",
    rootVisible: false,
    summary: "Source artifact URIs and source-text locator mappings.",
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
  {
    name: "readiness",
    summary: "Search index, LLM, WikiSpine, and generated-data prerequisites.",
  },
  {
    name: "library",
    summary:
      "Library registries, archive memberships, path binding, and aggregate indexes.",
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
  "file-import": "help/topics/file-import",
  "source-locators": "help/topics/source-locators",
  config: "help/topics/config",
  runtime: "help/topics/runtime",
  uri: "help/topics/uri",
  recipe: "help/topics/recipe",
  readiness: "help/topics/readiness",
  library: "help/topics/library",
};

let helpTemplateEnvironment:
  | ReturnType<typeof createNodeTemplateEnvironment>
  | undefined;

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

export function renderMaintenanceCommandHelpText(action?: "upgrade"): string {
  return renderHelpTemplate(
    action === undefined
      ? "help/commands/maintenance"
      : `help/commands/maintenance/${action}`,
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
    displayUri: uri,
    libraryContext: getLibraryHelpContext(uri),
    target: requireUriHelpTarget(targetName),
    uriContext: getUriHelpContext(uri),
    uri: formatHelpCommandUri(uri),
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
        formatCliCommand([uri, "--help"]),
      ),
    );
  }

  return renderHelpTemplate("help/commands/predicate", {
    displayUri: uri,
    libraryContext: getLibraryHelpContext(uri),
    predicate,
    target,
    uriContext: getUriHelpContext(uri),
    uri: formatHelpCommandUri(uri),
  });
}

export function renderLibraryUriHelpText(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
): string {
  const helpUri = formatLibraryHelpUri(uri, target);
  return renderHelpTemplate("help/commands/library", {
    target,
    uri: formatHelpCommandUri(helpUri),
  });
}

export function renderLibraryPredicateHelpText(
  uri: string,
  target: ParsedWikiGraphLibraryUri,
  predicate: LibraryHelpPredicateName,
): string {
  const helpUri = formatLibraryHelpUri(uri, target);
  return renderHelpTemplate("help/commands/library-predicate", {
    displayUri: helpUri,
    predicate,
    target,
    uri: formatHelpCommandUri(helpUri),
  });
}

function formatHelpCommandUri(uri: string): string {
  return formatShellArgument(uri);
}

function formatLibraryHelpUri(
  fallbackUri: string,
  target: ParsedWikiGraphLibraryUri,
): string {
  const scopeUri = formatWikiGraphLibraryUri(target.publicId);
  switch (target.kind) {
    case "archive":
      if (target.archivePublicId === undefined) {
        return fallbackUri.replace(/\/+$/u, "");
      }
      return appendLibraryHelpPath(
        appendLibraryHelpPath(`${scopeUri}/arc`, target.archivePublicId),
        stripHelpObjectUriPrefix(target.objectUri),
      );
    case "archive-collection":
      return `${scopeUri}/arc`;
    case "archive-path":
      return target.archivePublicId === undefined
        ? `${scopeUri}/arc/path`
        : `${scopeUri}/arc/${target.archivePublicId}/path`;
    case "archive-tree":
      return `${scopeUri}/arc/tree`;
    case "metadata":
      return `${scopeUri}/meta`;
    case "path":
      return `${scopeUri}/path`;
    case "registry":
      return "wikg://lib/registry";
    case "scope":
      return appendLibraryHelpPath(
        scopeUri,
        stripHelpObjectUriPrefix(target.objectUri),
      );
    default:
      throw new Error("Internal error: unknown library help target.");
  }
}

function appendLibraryHelpPath(
  baseUri: string,
  path: string | undefined,
): string {
  if (path === undefined || path === "") {
    return baseUri;
  }
  return `${baseUri.replace(/\/+$/u, "")}/${path.replace(/^\/+|\/+$/gu, "")}`;
}

function stripHelpObjectUriPrefix(
  objectUri: string | undefined,
): string | undefined {
  return objectUri?.replace(/^wikg:\/\//u, "");
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

function getLibraryHelpContext(uri: string): {
  readonly isArchiveShortcut: boolean;
  readonly isLibraryUri: boolean;
  readonly isLibraryWide: boolean;
} {
  const target = (() => {
    try {
      return parseWikiGraphLibraryUri(uri);
    } catch {
      return undefined;
    }
  })();

  if (target === undefined) {
    return {
      isArchiveShortcut: false,
      isLibraryUri: false,
      isLibraryWide: false,
    };
  }

  return {
    isArchiveShortcut: target.kind === "archive",
    isLibraryUri: true,
    isLibraryWide: target.kind === "scope" && target.objectUri !== undefined,
  };
}

function getUriHelpContext(uri: string): {
  readonly isChapterQualified: boolean;
} {
  const objectUri = getHelpObjectUri(uri);
  const target =
    objectUri === undefined ? undefined : parseChapterTarget(objectUri);

  return {
    isChapterQualified:
      target?.kind === "chapter-lens" ||
      target?.kind === "chapter-triple-pattern-lens",
  };
}

function getHelpObjectUri(uri: string): string | undefined {
  try {
    const libraryTarget = parseWikiGraphLibraryUri(uri);
    if (libraryTarget?.objectUri !== undefined) {
      return libraryTarget.objectUri;
    }
  } catch {
    // Fall through to the generic URI parser.
  }

  try {
    return parseLocatedWikiGraphUri(uri).objectUri;
  } catch {
    return undefined;
  }
}

function renderHelpTemplate(
  templateName: string,
  extraContext: Record<string, unknown> = {},
): string {
  return getHelpTemplateEnvironment().render(templateName, {
    formats: CLI_FORMATS,
    commandName: CLI_PRIMARY_COMMAND,
    fullCommandName: CLI_FULL_COMMAND,
    helpTopics: HELP_TOPIC_METADATA,
    archiveMaintenanceCommands: ARCHIVE_MAINTENANCE_COMMAND_METADATA,
    uriHelpTargets: URI_HELP_TARGETS,
    ...extraContext,
  });
}

function getHelpTemplateEnvironment(): ReturnType<
  typeof createNodeTemplateEnvironment
> {
  helpTemplateEnvironment ??= createNodeTemplateEnvironment(
    resolveCLIDataDirectory(),
    {
      autoescape: false,
    },
  );

  return helpTemplateEnvironment;
}

function resolveCLIDataDirectory(): string {
  const distDirectory = (
    globalThis as { readonly __WIKIGRAPH_CLI_DIST_DIR__?: unknown }
  ).__WIKIGRAPH_CLI_DIST_DIR__;
  const explicitProjectRoot = getCLIDevProjectRoot();
  const candidates = [
    typeof distDirectory === "string"
      ? resolve(distDirectory, "data")
      : undefined,
    explicitProjectRoot === undefined
      ? undefined
      : resolve(explicitProjectRoot, "packages", "cli", "data"),
  ];

  let directory = process.cwd();
  const root = parse(directory).root;
  while (true) {
    candidates.push(join(directory, "packages", "cli", "data"));
    if (directory === root) break;
    directory = dirname(directory);
  }

  const dataDirectory = candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(join(candidate, "help")),
  );
  if (dataDirectory === undefined) {
    throw new Error("Could not locate CLI help data directory.");
  }
  return dataDirectory;
}
