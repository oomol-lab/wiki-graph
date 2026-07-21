import { inferCLIFormatFromPath, parseCLIFormat } from "../support/index.js";
import { withHelpRoute } from "../support/index.js";
import { renderArchiveCommandHelpText } from "../help.js";
import {
  parseLocatedWikiGraphUri,
  type ArchiveTriplePattern,
} from "wiki-graph-core";
import type {
  ArchiveArgumentValues,
  CLIArchiveAction,
  CLIObjectKind,
  ParsedCLIArguments,
} from "./types.js";
import {
  formatMissingArchiveInputMessage,
  normalizeArchiveInlineOptions,
  parseArchiveInspectChapterId,
  parseEvidenceFlag,
  parsePositiveIntegerFlag,
  parseRelatedRoleFlag,
  parseResultFormat,
  parseSourceContextFlag,
  rejectArchiveBooleanFlag,
  rejectArchiveExtraPositionals,
  rejectArchiveFlag,
  rejectArchiveNonReadFlags,
  rejectArchiveReverseQuery,
  validateArchiveCommandUriInput,
  validateEvidenceTargetUri,
  validatePackTargetUri,
  validateRelatedTargetUri,
} from "./helpers.js";

export function parseArchiveArguments(
  action: CLIArchiveAction,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute = `wg ${action} --help`,
  options: {
    readonly defaultKinds?: readonly CLIObjectKind[];
    readonly triplePattern?: ArchiveTriplePattern;
  } = {},
): ParsedCLIArguments {
  const normalized = normalizeArchiveInlineOptions(positionals, values);

  positionals = normalized.positionals;
  values = normalized.values;

  const archivePath = positionals[0];

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveCommandHelpText(action),
      kind: "help",
    };
  }

  if (archivePath === undefined || archivePath === "-") {
    throw new Error(
      withHelpRoute(formatMissingArchiveInputMessage(action), helpRoute),
    );
  }

  validateArchiveCommandUriInput(action, archivePath);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support --verbose.`,
        helpRoute,
      ),
    );
  }

  switch (action) {
    case "create": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--output", values.output, helpRoute);
      rejectArchiveFlag(
        action,
        "--output-format",
        values["output-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
      rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
      if (
        values.import !== undefined &&
        inferCLIFormatFromPath(values.import) !== "epub"
      ) {
        throw new Error(
          withHelpRoute(
            "`create --import` only supports EPUB input.",
            helpRoute,
          ),
        );
      }
      return {
        args: {
          action,
          archivePath,
          ...(values.import === undefined ? {} : { importPath: values.import }),
          ...(values.json === undefined ? {} : { json: values.json }),
          ...(values.replace === undefined ? {} : { replace: values.replace }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "export":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--import", values.import, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.output === undefined ? {} : { outputPath: values.output }),
          outputFormat:
            values["output-format"] === undefined
              ? parseCLIFormat("markdown", "--output-format")
              : parseCLIFormat(values["output-format"], "--output-format"),
        },
        help: false,
        kind: "archive",
      };
    case "inspect": {
      const chapterId = parseArchiveInspectChapterId(positionals[0]);
      const parsedArchivePath =
        parseLocatedWikiGraphUri(archivePath).archivePath ?? archivePath;

      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      return {
        args: {
          action,
          archivePath: parsedArchivePath,
          ...(chapterId === undefined ? {} : { chapterId }),
          ...(values.json === true ? { json: true } : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "search": {
      const query = values.query;

      if (query === undefined) {
        throw new Error(
          withHelpRoute("Scope keyword retrieval requires --query.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);

      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          query,
          ...(options.defaultKinds === undefined
            ? {}
            : { kinds: options.defaultKinds }),
          ...(options.triplePattern === undefined
            ? {}
            : { triplePattern: options.triplePattern }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "list": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveReverseQuery(values, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          ...(values.reverse === true ? { reverse: true } : {}),
          ...(options.defaultKinds === undefined
            ? {}
            : { kinds: options.defaultKinds }),
          ...(options.triplePattern === undefined
            ? {}
            : { triplePattern: options.triplePattern }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "get": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveReverseQuery(values, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          objectId: archivePath,
          ...(values.reverse === true ? { reverse: true } : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "related": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      const relatedTarget = validateRelatedTargetUri(archivePath, helpRoute);
      if (relatedTarget === "chunk") {
        rejectArchiveFlag(action, "--role", values.role, helpRoute);
      }
      rejectArchiveReverseQuery(values, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          objectId: archivePath,
          ...(values.query === undefined ? {} : { query: values.query }),
          ...(values.reverse === true ? { reverse: true } : {}),
          ...(relatedTarget === "entity"
            ? parseRelatedRoleFlag(values.role, helpRoute)
            : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "evidence": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveReverseQuery(values, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      validateEvidenceTargetUri(archivePath, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          objectId: archivePath,
          ...(values.query === undefined ? {} : { query: values.query }),
          ...(values.reverse === true ? { reverse: true } : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "pack": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      validatePackTargetUri(archivePath, helpRoute);
      return {
        args: {
          action,
          archivePath,
          budget:
            values.budget === undefined
              ? 5000
              : parsePositiveIntegerFlag(values.budget, "--budget", helpRoute),
          format: parseResultFormat(values),
          objectId: archivePath,
        },
        help: false,
        kind: "archive",
      };
    }
    case "next": {
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);

      return {
        args: {
          action,
          archivePath,
          ...(positionals[1] === undefined ? {} : { cursor: positionals[1] }),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
        },
        help: false,
        kind: "archive",
      };
    }
  }
}
