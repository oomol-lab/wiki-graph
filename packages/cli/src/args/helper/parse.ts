import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import { formatCliCommand } from "../../support/index.js";
import type { ArchiveArgumentValues, CLIResultFormat } from "../types.js";
import { isWikiGraphLocalConfigUri, isWikiGraphUri } from "./uri.js";

export function parseWatchFrom(
  value: string | undefined,
  helpRoute: string,
): "beginning" | "now" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "beginning" || value === "now") {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --from: ${value}. Expected beginning or now.`,
      helpRoute,
    ),
  );
}

export function parseResultFormat(values: {
  readonly json?: boolean;
  readonly jsonl?: boolean;
}): CLIResultFormat {
  if (values.json === true && values.jsonl === true) {
    throw new Error(
      withHelpRoute(
        "`--json` and `--jsonl` cannot be combined.",
        CLI_HELP_ROUTES.command,
      ),
    );
  }

  if (values.json === true) {
    return "json";
  }
  if (values.jsonl === true) {
    return "jsonl";
  }

  return "text";
}

export function parseEvidenceFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly evidenceLimit?: number } {
  if (value === undefined) {
    return {};
  }

  return {
    evidenceLimit: parseNonNegativeIntegerFlag(value, "--evidence", helpRoute),
  };
}

export function parseSourceContextFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly context?: number } {
  if (value === undefined) {
    return {};
  }

  return {
    context: parseNonNegativeIntegerFlag(value, "--context", helpRoute),
  };
}
export function parseNonNegativeIntegerFlag(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      withHelpRoute(`${flag} must be a non-negative integer.`, helpRoute),
    );
  }

  return parsed;
}

export function parsePositiveIntegerFlag(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      withHelpRoute(`${flag} must be a positive integer.`, helpRoute),
    );
  }

  return parsed;
}

export function normalizeArchiveInlineOptions(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): {
  readonly positionals: readonly string[];
  readonly values: ArchiveArgumentValues;
} {
  const normalizedPositionals: string[] = [];
  const normalizedValues: Record<
    string,
    boolean | readonly string[] | string | undefined
  > = {
    ...values,
  };

  for (let index = 0; index < positionals.length; index += 1) {
    const item = positionals[index];

    if (item === undefined) {
      continue;
    }

    switch (item) {
      case "--json":
      case "--confirm":
      case "--reverse":
        normalizedValues[item.slice(2)] = true;
        continue;
      case "--budget":
      case "--chapter":
      case "--context":
      case "--cursor":
      case "--import":
      case "--input":
      case "--input-format":
      case "--limit":
      case "--llm":
      case "--output":
      case "--output-format":
      case "--prompt":
      case "--stage":
      case "--to": {
        const value = positionals[index + 1];

        if (value === undefined) {
          normalizedPositionals.push(item);
          continue;
        }

        normalizedValues[item.slice(2)] = value;
        index += 1;
        continue;
      }
      default:
        normalizedPositionals.push(item);
    }
  }

  return {
    positionals: normalizedPositionals,
    values: normalizedValues,
  };
}

export function normalizeArchiveValueFlagArgv(
  argv: readonly string[],
): readonly string[] {
  const normalized: string[] = [];
  let stopped = false;
  const jsonMayTakeValue = isValueInputJsonFlagContext(argv);

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === undefined) {
      continue;
    }

    if (stopped) {
      normalized.push(item);
      continue;
    }

    if (item === "--") {
      normalized.push(item);
      stopped = true;
      continue;
    }

    if (item.startsWith("--json=") && jsonMayTakeValue) {
      normalized.push("--json");
      normalized.push(`--json-input=${item.slice("--json=".length)}`);
      continue;
    }

    if (item === "--json" && jsonMayTakeValue) {
      const value = argv[index + 1];

      normalized.push(item);
      if (value !== undefined && !value.startsWith("-")) {
        normalized.push("--json-input");
        normalized.push(value);
        index += 1;
      }
      continue;
    }

    if (item !== "--evidence" && item !== "--context") {
      normalized.push(item);
      continue;
    }

    const value = argv[index + 1];

    if (value !== undefined && !value.startsWith("-")) {
      normalized.push(item);
      normalized.push(value);
      index += 1;
      continue;
    }

    if (value !== undefined && /^-\d/.test(value)) {
      normalized.push(`${item}=${value}`);
      index += 1;
      continue;
    }

    normalized.push(item);
    if (item === "--evidence") {
      normalized.push("3");
    }
  }

  return normalized;
}

export function isValueInputJsonFlagContext(argv: readonly string[]): boolean {
  const first = argv[0];
  const second = argv[1];

  if (second !== "set" && second !== "put") {
    return false;
  }
  if (isWikiGraphLocalConfigUri(first)) {
    return true;
  }

  return (
    isWikiGraphUri(first) &&
    argv.some((item) => item.includes("/meta") || item.endsWith(".wikg/meta"))
  );
}
export function formatWikiGraphHelpCommand(
  uri: string,
  action?: string,
): string {
  return formatCliCommand([
    uri,
    ...(action === undefined ? [] : [action]),
    "--help",
  ]);
}
