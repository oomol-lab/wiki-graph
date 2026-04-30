export const CLI_HELP_ROUTES = {
  command: "spinedigest help command",
  config: "spinedigest help config",
  "config-file": "spinedigest help config-file",
  env: "spinedigest help env",
  format: "spinedigest help format",
  root: "spinedigest --help",
  runtime: "spinedigest help runtime",
  sdpub: "spinedigest sdpub --help",
} as const;

export function sdpubSubcommandHelpRoute(subcommand: string): string {
  return `spinedigest sdpub ${subcommand} --help`;
}

export function withHelpRoute(message: string, route: string): string {
  return `${message}\nSee: ${route}`;
}
