import { resolveDataDirPath } from "../common/data-dir.js";
import { createEnv } from "../common/template.js";

import { CLI_FORMATS } from "./formats.js";

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
  "sdpub",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export const SDPUB_SUBCOMMANDS = [
  "info",
  "toc",
  "list",
  "cat",
  "cover",
] as const;

export type SDPubSubcommand = (typeof SDPUB_SUBCOMMANDS)[number];

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
  {
    name: "sdpub",
    summary: "The .sdpub inspection command family and its subcommands.",
  },
] as const;

const SDPUB_SUBCOMMAND_METADATA: readonly {
  readonly name: SDPubSubcommand;
  readonly summary: string;
}[] = [
  {
    name: "info",
    summary: "Print archive metadata, cover presence, and aggregate counts.",
  },
  {
    name: "toc",
    summary: "Print the TOC tree, including any referenced serial ids.",
  },
  {
    name: "list",
    summary: "List serial ids with their TOC paths and fragment counts.",
  },
  {
    name: "cat",
    summary: "Print the summary text for one serial id.",
  },
  {
    name: "cover",
    summary: "Write raw cover bytes to stdout for redirection or piping.",
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
  sdpub: "help/topics/sdpub",
};

let helpTemplateEnvironment: ReturnType<typeof createEnv> | undefined;

export function renderMainHelpText(): string {
  return renderHelpTemplate("help/commands/root");
}

export function renderHelpTopicText(topic: HelpTopic): string {
  return renderHelpTemplate(HELP_TOPIC_TEMPLATE_NAMES[topic]);
}

export function renderSdpubHelpText(): string {
  return renderHelpTemplate("help/commands/sdpub/index");
}

export function renderSdpubSubcommandHelpText(
  subcommand: SDPubSubcommand,
): string {
  return renderHelpTemplate(`help/commands/sdpub/${subcommand}`);
}

export function parseHelpTopic(value: string): HelpTopic {
  const normalized = value.trim().toLowerCase();

  if (HELP_TOPICS.includes(normalized as HelpTopic)) {
    return normalized as HelpTopic;
  }

  throw new Error(
    `Invalid help topic: ${value}. Expected one of ${HELP_TOPICS.join(", ")}.`,
  );
}

function renderHelpTemplate(templateName: string): string {
  return getHelpTemplateEnvironment().render(templateName, {
    formats: CLI_FORMATS,
    helpTopics: HELP_TOPIC_METADATA,
    sdpubCommands: SDPUB_SUBCOMMAND_METADATA,
  });
}

function getHelpTemplateEnvironment(): ReturnType<typeof createEnv> {
  helpTemplateEnvironment ??= createEnv(resolveDataDirPath(), {
    autoescape: false,
  });

  return helpTemplateEnvironment;
}
