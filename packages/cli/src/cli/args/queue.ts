import { parseLocatedWikiGraphUri } from "wiki-graph-core";
import { withHelpRoute } from "../support/index.js";
import {
  isUriHelpPredicate,
  renderUriHelpText,
  renderUriPredicateHelpText,
} from "../help.js";
import type {
  ArchiveArgumentValues,
  CLIQueueAction,
  ParsedCLIArguments,
} from "./types.js";
import {
  formatRemovedImplicitVerbMessage,
  formatWikiGraphHelpCommand,
  isJobUriAction,
  isRemovedImplicitArchiveAction,
  parseBuildJobTarget,
  parseWatchFrom,
  parseWikiGraphJobTargetUri,
  parseWikiGraphJobUri,
  rejectQueueExtraPositionals,
  rejectStreamingJSONFlag,
  requireArchiveUriPath,
} from "./helpers.js";
import { parseChapterTarget } from "./uri.js";

export function parseJobUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const jobTargetUri = parseWikiGraphJobTargetUri(uri);
  const explicitAction = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing job URI.");
  }

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  if (values.help === true) {
    if (explicitAction === undefined) {
      return {
        help: true,
        helpText: renderUriHelpText(
          jobTargetUri === undefined && parseWikiGraphJobUri(uri) === undefined
            ? "job-collection-scope"
            : jobTargetUri === undefined
              ? "job-object"
              : "job-target-object",
          uri,
        ),
        kind: "help",
      };
    }
    const targetName =
      jobTargetUri === undefined && parseWikiGraphJobUri(uri) === undefined
        ? "job-collection-scope"
        : jobTargetUri === undefined
          ? "job-object"
          : "job-target-object";
    if (isUriHelpPredicate(targetName, explicitAction)) {
      return {
        help: true,
        helpText: renderUriPredicateHelpText(targetName, explicitAction, uri),
        kind: "help",
      };
    }
  }

  const jobId = jobTargetUri ?? parseWikiGraphJobUri(uri);
  const action =
    explicitAction ??
    (jobTargetUri !== undefined
      ? undefined
      : jobId === undefined
        ? "list"
        : "get");

  if (!isJobUriAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? `Missing action after ${uri}.`
          : `The job URI form does not support \`${action}\`.`,
        "wg wikg://local/job --help",
      ),
    );
  }

  const helpRoute =
    explicitAction === undefined
      ? formatWikiGraphHelpCommand(uri)
      : formatWikiGraphHelpCommand(uri, action);
  const tail = explicitAction === undefined ? [] : positionals.slice(2);

  if (jobTargetUri !== undefined) {
    if (action !== "set") {
      throw new Error(
        withHelpRoute(
          `The job target URI form does not support \`${action}\`. Expected set.`,
          "wg wikg://local/job/<job-id>/target set --help",
        ),
      );
    }
    return parseQueueJobTargetUriArguments(
      jobTargetUri,
      tail,
      values,
      helpRoute,
    );
  }

  switch (action) {
    case "add":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job add requires `wikg://local/job`.", helpRoute),
        );
      }
      return parseQueueAddArguments(tail, values, helpRoute);
    case "clean":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job clean requires `wikg://local/job`.", helpRoute),
        );
      }
      rejectQueueJSONFlag("clean", values.json, helpRoute);
      rejectQueueJSONLFlag("clean", values.jsonl, helpRoute);
      rejectQueueExtraPositionals("clean", ["clean", ...tail], 1, helpRoute);
      return {
        args: {
          action: "clean",
        },
        help: false,
        kind: "queue",
      };
    case "list":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job list requires `wikg://local/job`.", helpRoute),
        );
      }
      rejectQueueJSONLFlag("list", values.jsonl, helpRoute);
      rejectQueueExtraPositionals("list", ["list", ...tail], 1, helpRoute);
      return {
        args: {
          action: "list",
          ...(values.active === undefined ? {} : { activeOnly: values.active }),
          ...(values.all === undefined ? {} : { all: values.all }),
          ...(values.input === undefined
            ? {}
            : { archivePath: requireArchiveUriPath(values.input, helpRoute) }),
          ...(values.json === undefined ? {} : { json: values.json }),
        },
        help: false,
        kind: "queue",
      };
    case "get":
      return parseQueueJobArguments("status", jobId, tail, values, helpRoute);
    case "watch":
    case "pause":
    case "resume":
    case "cancel":
    case "boost":
      return parseQueueJobArguments(action, jobId, tail, values, helpRoute);
    case "set":
      throw new Error(
        withHelpRoute(
          "`wikg://local/job/<job-id> set` is not supported. Use `wikg://local/job/<job-id>/target set <target>`.",
          "wg wikg://local/job/<job-id>/target set --help",
        ),
      );
  }

  throw new Error("Internal error: unsupported job URI action.");
}

function parseQueueJobTargetUriArguments(
  jobId: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  rejectQueueJSONFlag("target", values.json, helpRoute);
  rejectQueueJSONLFlag("target", values.jsonl, helpRoute);
  rejectQueueExtraPositionals(
    "target",
    ["target", jobId, ...tail],
    3,
    helpRoute,
  );

  const target = tail[0];
  if (target === undefined) {
    throw new Error(withHelpRoute("Missing build job target.", helpRoute));
  }

  return {
    args: {
      action: "target",
      jobId,
      target: parseBuildJobTarget(target),
    },
    help: false,
    kind: "queue",
  };
}

function rejectQueueJSONFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wg wikg://local/job ${action}\` does not support --json.`,
      helpRoute,
    ),
  );
}

function parseQueueAddArguments(
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  const action = "add";

  rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  rejectQueueFlag(action, "--stage", values.stage, helpRoute);
  rejectQueueFlag(action, "--to", values.to, helpRoute);
  rejectQueueFlag(action, "--chapter", values.chapter, helpRoute);
  rejectQueueExtraPositionals(action, [action, ...tail], 1, helpRoute);
  if (values.input === undefined) {
    throw new Error(withHelpRoute("Missing --input.", helpRoute));
  }

  const input = parseQueueAddInput(values.input, helpRoute);

  return {
    args: {
      action,
      ...(values["accept-cost"] === undefined
        ? {}
        : { acceptCost: values["accept-cost"] }),
      archivePath: input.archivePath,
      ...(values.boost === undefined ? {} : { boost: values.boost }),
      ...(input.chapterId === undefined ? {} : { chapterId: input.chapterId }),
      inputPath: values.input,
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
      target: parseBuildJobTarget(values.task),
    },
    help: false,
    kind: "queue",
  };
}

function parseQueueAddInput(
  uri: string,
  helpRoute: string,
): { readonly archivePath: string; readonly chapterId?: number } {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(
        `Expected an archive or chapter Wiki Graph URI: ${uri}`,
        helpRoute,
      ),
    );
  }
  if (parsed.objectUri === undefined) {
    return { archivePath: parsed.archivePath };
  }

  const chapterTarget = parseChapterTarget(parsed.objectUri);
  if (chapterTarget?.kind !== "chapter") {
    throw new Error(
      withHelpRoute(
        `Expected an archive or chapter Wiki Graph URI: ${uri}`,
        helpRoute,
      ),
    );
  }

  return {
    archivePath: parsed.archivePath,
    chapterId: chapterTarget.chapterId,
  };
}

function parseQueueJobArguments(
  action: Exclude<CLIQueueAction, "add" | "clean" | "list">,
  jobId: string | undefined,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "status") {
    rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  } else if (action === "watch") {
    rejectStreamingJSONFlag(action, values.json, helpRoute);
  } else {
    rejectQueueJSONFlag(action, values.json, helpRoute);
    rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  }

  if (action !== "target") {
    rejectQueueFlag(action, "--stage", values.stage, helpRoute);
    rejectQueueFlag(action, "--to", values.to, helpRoute);
  } else {
    rejectQueueFlag(action, "--stage", values.stage, helpRoute);
    rejectQueueFlag(action, "--to", values.to, helpRoute);
  }

  if (jobId === undefined) {
    throw new Error(
      withHelpRoute(
        `\`wg wikg://local/job/<job-id> ${action}\` requires <job-id>.`,
        helpRoute,
      ),
    );
  }

  rejectQueueExtraPositionals(action, [action, jobId, ...tail], 2, helpRoute);

  if (action === "watch") {
    const watchFrom = parseWatchFrom(values.from, helpRoute);

    return {
      args: {
        action,
        jobId,
        ...(watchFrom === undefined ? {} : { from: watchFrom }),
        ...(values.jsonl === undefined ? {} : { jsonl: values.jsonl }),
      },
      help: false,
      kind: "queue",
    };
  }

  if (action === "status") {
    return {
      args: {
        action,
        jobId,
        ...(values.json === undefined ? {} : { json: values.json }),
      },
      help: false,
      kind: "queue",
    };
  }

  if (action === "target") {
    return {
      args: {
        action,
        jobId,
        target: parseBuildJobTarget(values.task),
      },
      help: false,
      kind: "queue",
    };
  }

  return {
    args: {
      action,
      jobId,
    },
    help: false,
    kind: "queue",
  };
}

function rejectQueueJSONLFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wg wikg://local/job ${action}\` does not support --jsonl.`,
      helpRoute,
    ),
  );
}

function rejectQueueFlag(
  action: CLIQueueAction,
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value === undefined) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wg wikg://local/job ${action}\` does not support ${name}.`,
      helpRoute,
    ),
  );
}
