import { CLI_PRIMARY_COMMAND } from "../common/cli-command.js";

const SAFE_SHELL_ARGUMENT_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/u;

export function formatShellArgument(argument: string): string {
  if (argument !== "" && SAFE_SHELL_ARGUMENT_PATTERN.test(argument)) {
    return argument;
  }

  return `'${argument.replaceAll("'", "'\\''")}'`;
}

export function formatShellCommand(arguments_: readonly string[]): string {
  return arguments_.map(formatShellArgument).join(" ");
}

export function formatCliCommand(arguments_: readonly string[]): string {
  return formatShellCommand([CLI_PRIMARY_COMMAND, ...arguments_]);
}
