import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { WIKI_GRAPH_URI_PREFIX } from "wiki-graph-core";
import type {
  ArchiveArgumentValues,
  ArchiveMetaFlagValues,
  CLIArchiveChapterAction,
  CLIArchiveMaintenanceCommand,
  CLIQueueAction,
} from "./types.js";

export function rejectArchiveChapterFlag(
  name: string,
  value: boolean | string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectArchiveChapterMetaFlags(
  values: ArchiveMetaFlagValues,
  helpRoute: string,
): void {
  for (const flag of listPresentMetaFlags(values, { includeTitle: false })) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectHelpMetaFlags(values: ArchiveMetaFlagValues): void {
  rejectCommandMetaFlags(values, "help", CLI_HELP_ROUTES.root);
}

export function rejectNonGcForceFlag(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): void {
  if (values.force !== true || positionals[0] === "gc") {
    return;
  }

  throw new Error(
    withHelpRoute(
      "The --force option is only supported by `gc`.",
      CLI_HELP_ROUTES.root,
    ),
  );
}

export function rejectNonCreateReplaceFlag(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): void {
  if (values.replace !== true) {
    return;
  }

  const [command, action] = positionals;
  if (
    command?.startsWith(WIKI_GRAPH_URI_PREFIX) === true &&
    action === "create"
  ) {
    return;
  }

  throw new Error(
    withHelpRoute(
      "The --replace option is only supported by `wg <archive-uri> create`.",
      CLI_HELP_ROUTES.root,
    ),
  );
}

export function rejectGcMetaFlags(values: ArchiveMetaFlagValues): void {
  rejectCommandMetaFlags(values, "gc", "wg gc --help");
}

export function rejectCommandMetaFlags(
  values: ArchiveMetaFlagValues,
  command: string,
  helpRoute: string,
): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`${command}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectGcFlag(
  name: string,
  value: string | boolean | readonly string[] | undefined,
  helpRoute: string,
): void {
  if (value === undefined || value === false) {
    return;
  }

  throw new Error(
    withHelpRoute(`The \`gc\` command does not support --${name}.`, helpRoute),
  );
}

export function rejectTransformFlag(
  name: string,
  value: boolean | string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectTransformMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support ${flag}.`,
        "wg transform --help",
      ),
    );
  }
}

export function listPresentMetaFlags(
  values: ArchiveMetaFlagValues,
  options: { readonly includeTitle?: boolean } = {},
): readonly string[] {
  const includeTitle = options.includeTitle ?? true;
  const flags: string[] = [];

  if (values.author !== undefined) flags.push("--author");
  if (values["clear-authors"] !== undefined) flags.push("--clear-authors");
  if (values["clear-description"] !== undefined) {
    flags.push("--clear-description");
  }
  if (values["clear-identifier"] !== undefined) {
    flags.push("--clear-identifier");
  }
  if (values["clear-language"] !== undefined) flags.push("--clear-language");
  if (values["clear-published-at"] !== undefined) {
    flags.push("--clear-published-at");
  }
  if (values["clear-publisher"] !== undefined) flags.push("--clear-publisher");
  if (includeTitle && values["clear-title"] !== undefined) {
    flags.push("--clear-title");
  }
  if (values.description !== undefined) flags.push("--description");
  if (values.identifier !== undefined) flags.push("--identifier");
  if (values.language !== undefined) flags.push("--language");
  if (values["published-at"] !== undefined) flags.push("--published-at");
  if (values.publisher !== undefined) flags.push("--publisher");
  if (includeTitle && values.title !== undefined) flags.push("--title");

  return flags;
}

export function requireChapterId(
  chapterId: number | undefined,
  action: CLIArchiveChapterAction,
  helpRoute: string,
): asserts chapterId is number {
  if (chapterId === undefined) {
    throw new Error(
      withHelpRoute(
        `Missing --chapter. \`chapter ${action}\` requires a chapter id.`,
        helpRoute,
      ),
    );
  }
}

export function rejectHelpFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support --${name}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}
export function rejectArchiveReverseQuery(
  values: Pick<ArchiveArgumentValues, "query" | "reverse">,
  helpRoute: string,
): void {
  if (values.query !== undefined && values.reverse === true) {
    throw new Error(
      withHelpRoute("`--reverse` cannot be combined with --query.", helpRoute),
    );
  }
}

export function parseRelatedRoleFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly role?: "any" | "object" | "self" | "subject" } {
  if (value === undefined) {
    return {};
  }
  if (
    value !== "any" &&
    value !== "object" &&
    value !== "self" &&
    value !== "subject"
  ) {
    throw new Error(
      withHelpRoute(
        "--role must be one of: any, subject, object, self.",
        helpRoute,
      ),
    );
  }

  return { role: value };
}
export function rejectArchiveExtraPositionals(
  action: string,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${action}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectQueueExtraPositionals(
  action: CLIQueueAction,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`queue ${action}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectArchiveMaintenanceExtraPositionals(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${command}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectMetaCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectMetaCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectCoverCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectCoverCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectCoverMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support ${flag}.`,
        "wg cover --help",
      ),
    );
  }
}

export function rejectArchiveFlag(
  action: string,
  flag: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectArchiveBooleanFlag(
  action: string,
  flag: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectStreamingJSONFlag(
  action: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `The \`${action}\` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.`,
      helpRoute,
    ),
  );
}

export function rejectArchiveNonReadFlags(
  action: string,
  values: {
    readonly input?: string;
    readonly import?: string;
    readonly "input-format"?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
  },
  helpRoute: string,
): void {
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(action, "--import", values.import, helpRoute);
  rejectArchiveFlag(
    action,
    "--input-format",
    values["input-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
  rejectArchiveFlag(action, "--output", values.output, helpRoute);
  rejectArchiveFlag(
    action,
    "--output-format",
    values["output-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
}
