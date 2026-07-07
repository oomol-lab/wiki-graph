import { CLI_PRIMARY_COMMAND } from "../common/cli-command.js";

export const CLI_HELP_ROUTES = {
  command: `${CLI_PRIMARY_COMMAND} --help`,
  config: `${CLI_PRIMARY_COMMAND} help config`,
  format: `${CLI_PRIMARY_COMMAND} help format`,
  readiness: `${CLI_PRIMARY_COMMAND} help readiness`,
  root: `${CLI_PRIMARY_COMMAND} --help`,
  runtime: `${CLI_PRIMARY_COMMAND} help runtime`,
  uri: `${CLI_PRIMARY_COMMAND} help uri`,
} as const;

export function archiveMaintenanceHelpRoute(subcommand: string): string {
  return `${CLI_PRIMARY_COMMAND} ${subcommand} --help`;
}

export function withHelpRoute(message: string, route: string): string {
  return `${message}\nSee: ${route}`;
}
