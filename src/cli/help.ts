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
  "overview",
  "task",
  "command",
  "format",
  "config",
  "env",
  "config-file",
  "runtime",
  "recipe",
  "troubleshoot",
  "ai",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export const ARCHIVE_COMMANDS = [
  "create",
  "estimate",
  "status",
  "index",
  "list",
  "find",
  "grep",
  "page",
  "read",
  "links",
  "backlinks",
  "related",
  "path",
  "map",
  "pack",
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
    name: "overview",
    summary: "Mental model, processing paths, and when LLM access is needed.",
  },
  {
    name: "task",
    summary: "Task-oriented entry points for common workflows.",
  },
  {
    name: "command",
    summary: "Top-level commands, flags, and command family boundaries.",
  },
  {
    name: "format",
    summary: "Supported formats, inference rules, and IO constraints.",
  },
  {
    name: "config",
    summary: "Configuration overview, precedence, and when each layer applies.",
  },
  {
    name: "env",
    summary: "Detailed environment variable reference.",
  },
  {
    name: "config-file",
    summary: "Detailed ~/.spinedigest/config.json reference.",
  },
  {
    name: "runtime",
    summary: "Exit behavior, streams, progress, and digest workspace rules.",
  },
  {
    name: "recipe",
    summary: "Short copyable command examples.",
  },
  {
    name: "troubleshoot",
    summary: "Common failure modes and what to check first.",
  },
  {
    name: "ai",
    summary: "Navigation hints and operating contract for AI agents.",
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
    summary: "Read or edit book metadata stored in the archive.",
  },
  {
    name: "chapter",
    summary: "Edit the chapter tree and per-chapter digest stages.",
  },
] as const;

const HELP_TOPIC_TEMPLATE_NAMES: Readonly<Record<HelpTopic, string>> = {
  overview: "help/topics/overview",
  task: "help/topics/task",
  command: "help/topics/command",
  format: "help/topics/format",
  config: "help/topics/config",
  env: "help/topics/env",
  "config-file": "help/topics/config-file",
  runtime: "help/topics/runtime",
  recipe: "help/topics/recipe",
  troubleshoot: "help/topics/troubleshoot",
  ai: "help/topics/ai",
};

let helpTemplateEnvironment: ReturnType<typeof createEnv> | undefined;

export function renderMainHelpText(): string {
  return renderHelpTemplate("help/commands/root");
}

export function renderStatusHelpText(): string {
  return renderHelpTemplate("help/commands/config-status");
}

export function renderTransformHelpText(): string {
  return renderHelpTemplate("help/commands/transform");
}

export function renderQueueCommandHelpText(): string {
  return renderHelpTemplate("help/commands/queue");
}

export function renderArchiveCommandHelpText(action: CLIArchiveAction): string {
  return renderHelpTemplate(`help/commands/archive/${action}`);
}

export function renderHelpTopicText(topic: HelpTopic): string {
  return renderHelpTemplate(HELP_TOPIC_TEMPLATE_NAMES[topic]);
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

function renderHelpTemplate(templateName: string): string {
  return getHelpTemplateEnvironment().render(templateName, {
    formats: CLI_FORMATS,
    helpTopics: HELP_TOPIC_METADATA,
    archiveMaintenanceCommands: ARCHIVE_MAINTENANCE_COMMAND_METADATA,
  });
}

function getHelpTemplateEnvironment(): ReturnType<typeof createEnv> {
  helpTemplateEnvironment ??= createEnv(resolveDataDirPath(), {
    autoescape: false,
  });

  return helpTemplateEnvironment;
}
