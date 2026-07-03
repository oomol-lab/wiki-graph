export const CLI_HELP_ROUTES = {
  command: "wikigraph help command",
  config: "wikigraph help config",
  format: "wikigraph help format",
  root: "wikigraph --help",
  runtime: "wikigraph help runtime",
} as const;

export function archiveMaintenanceHelpRoute(subcommand: string): string {
  return `wikigraph ${subcommand} --help`;
}

export function withHelpRoute(message: string, route: string): string {
  return `${message}\nSee: ${route}`;
}
