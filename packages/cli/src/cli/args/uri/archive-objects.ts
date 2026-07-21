import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import { renderArchiveMaintenanceCommandHelpText, renderUriHelpText } from "../../help.js";
import { parseArchiveArguments } from "../archive.js";
import type { ArchiveArgumentValues, CLIArchiveUriAction, ParsedCLIArguments } from "../types.js";
import {
  formatWikiGraphHelpCommand,
  isArchiveAction,
  isArchiveIndexAction,
  rejectArchiveBooleanFlag,
  rejectArchiveExtraPositionals,
  rejectArchiveFlag,
  rejectArchiveMaintenanceExtraPositionals,
  rejectArchiveNonReadFlags,
  rejectCommandMetaFlags,
  rejectCoverCommandBooleanFlag,
  rejectCoverCommandFlag,
  rejectCoverMetaFlags,
  rejectStreamingJSONFlag,
} from "../helpers.js";

export function parseArchiveUriArchiveArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (!isArchiveAction(action)) {
    throw new Error(
      withHelpRoute(
        `The archive URI form does not support \`${action}\`. Use \`wg <archive-uri> --help\` to inspect valid verbs.`,
        "wg <archive-uri> --help",
      ),
    );
  }

  if (action === "get") {
    return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
  }

  if (
    action !== "create" &&
    action !== "export" &&
    action !== "inspect" &&
    action !== "list" &&
    action !== "search"
  ) {
    throw new Error(
      withHelpRoute(
        `The archive URI ${uri} cannot be used with \`${action}\`; use a concrete object URI. Use \`wg <archive-uri> --help\` to inspect valid archive verbs.`,
        "wg <archive-uri> --help",
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [action === "create" || action === "export" ? archivePath : uri, ...tail],
    values,
    helpRoute,
  );
}

export function parseArchiveCoverUriArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("cover"),
      kind: "maintenance",
    };
  }

  if (action !== "get") {
    throw new Error(
      withHelpRoute(
        `The cover object does not support \`${action}\`. Read the cover URI directly.`,
        "wg <cover-uri> --help",
      ),
    );
  }

  rejectArchiveMaintenanceExtraPositionals("cover", tail, 0, helpRoute);
  rejectCoverCommandFlag("budget", values.budget, helpRoute);
  rejectCoverCommandFlag("chapter", values.chapter, helpRoute);
  rejectCoverCommandFlag("cursor", values.cursor, helpRoute);
  rejectCoverCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectCoverCommandFlag("import", values.import, helpRoute);
  rejectCoverCommandFlag("input", values.input, helpRoute);
  rejectCoverCommandFlag("input-format", values["input-format"], helpRoute);
  rejectCoverCommandFlag("limit", values.limit, helpRoute);
  rejectCoverCommandFlag("output", values.output, helpRoute);
  rejectCoverCommandFlag("output-format", values["output-format"], helpRoute);
  rejectCoverCommandFlag("prompt", values.prompt, helpRoute);
  rejectCoverCommandFlag("stage", values.stage, helpRoute);
  rejectCoverCommandFlag("to", values.to, helpRoute);
  rejectCoverCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectCoverCommandBooleanFlag("json", values.json, helpRoute);
  rejectCoverMetaFlags(values);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute("The cover command does not support --verbose.", helpRoute),
    );
  }

  return {
    args: {
      inputPath: archivePath,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    },
    help: false,
    kind: "cover",
  };
}

export function parseArchiveIndexUriArguments(
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = `wg wikg://<archive.wikg>/index ${action} --help`;

  if (values.help === true) {
    return {
      help: true,
      helpText: renderUriHelpText(
        "index-object",
        "wikg://<archive.wikg>/index",
      ),
      kind: "help",
    };
  }

  if (!isArchiveIndexAction(action)) {
    throw new Error(
      withHelpRoute(
        `The index object does not support \`${action}\`. Read the index object directly, or use enable, disable, embed, or external.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }
  rejectArchiveExtraPositionals(action, tail, 0, helpRoute);
  rejectArchiveNonReadFlags(action, values, helpRoute);
  rejectArchiveFlag(action, "--after", values.after, helpRoute);
  rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
  rejectArchiveFlag(action, "--before", values.before, helpRoute);
  rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
  rejectArchiveFlag(action, "--context", values.context, helpRoute);
  rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
  rejectArchiveFlag(action, "--digest-dir", values["digest-dir"], helpRoute);
  rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
  rejectArchiveFlag(action, "--from", values.from, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);
  rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
  rejectArchiveFlag(action, "--parent", values.parent, helpRoute);
  rejectArchiveFlag(action, "--predicate", values.predicate, helpRoute);
  rejectArchiveFlag(action, "--role", values.role, helpRoute);
  rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
  rejectArchiveFlag(action, "--task", values.task, helpRoute);
  rejectArchiveFlag(action, "--to", values.to, helpRoute);
  rejectArchiveBooleanFlag(
    action,
    "--accept-cost",
    values["accept-cost"],
    helpRoute,
  );
  rejectArchiveBooleanFlag(action, "--active", values.active, helpRoute);
  rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
  rejectArchiveBooleanFlag(action, "--backlinks", values.backlinks, helpRoute);
  rejectArchiveBooleanFlag(action, "--boost", values.boost, helpRoute);
  rejectArchiveBooleanFlag(action, "--clear", values.clear, helpRoute);
  rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
  rejectArchiveBooleanFlag(action, "--dry-run", values["dry-run"], helpRoute);
  rejectArchiveBooleanFlag(action, "--first", values.first, helpRoute);
  if (action === "enable") {
    rejectStreamingJSONFlag(action, values.json, helpRoute);
  } else {
    rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  }
  rejectArchiveBooleanFlag(action, "--last", values.last, helpRoute);
  rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
  rejectArchiveBooleanFlag(action, "--root", values.root, helpRoute);
  rejectArchiveBooleanFlag(action, "--verbose", values.verbose, helpRoute);
  rejectCommandMetaFlags(values, action, helpRoute);

  return {
    args: {
      action,
      archivePath,
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values.jsonl === undefined ? {} : { jsonl: values.jsonl }),
    },
    help: false,
    kind: "archive-index",
  };
}
