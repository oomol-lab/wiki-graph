import {
  isUriHelpPredicate,
  renderUriHelpText,
  renderUriPredicateHelpText,
} from "../help.js";
import type { LocalConfigSection } from "../../runtime/local-config.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "../../support/index.js";
import type {
  ArchiveArgumentValues,
  CLILocalConfigAction,
  ParsedCLIArguments,
} from "../types.js";
import {
  formatRemovedImplicitVerbMessage,
  formatWikiGraphHelpCommand,
  isRemovedImplicitArchiveAction,
  parseLocalConfigUriSection,
  rejectArchiveExtraPositionals,
  rejectCommandMetaFlags,
  rejectMetaCommandBooleanFlag,
  rejectMetaCommandFlag,
} from "../helpers.js";

export function parseLocalConfigUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];

  if (uri === undefined) {
    throw new Error("Internal error: missing local config URI.");
  }

  const section = parseLocalConfigUriSection(uri);
  const explicitAction = positionals[1];

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  const action = explicitAction ?? "get";
  const helpRoute =
    explicitAction === undefined
      ? formatWikiGraphHelpCommand(uri)
      : formatWikiGraphHelpCommand(uri, action);

  if (section === undefined) {
    if (
      values.help === true &&
      explicitAction === undefined &&
      uri === "wikg://local/config"
    ) {
      return {
        help: true,
        helpText: renderUriHelpText("local-config-namespace", uri),
        kind: "help",
      };
    }
    throw new Error(
      withHelpRoute(
        "Expected a local config section URI such as wikg://local/config/llm.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }
  if (values.help === true && explicitAction === undefined) {
    return {
      help: true,
      helpText: renderUriHelpText("local-config-section", uri),
      kind: "help",
    };
  }
  if (values.help === true && explicitAction !== undefined) {
    if (!isUriHelpPredicate("local-config-section", action)) {
      throw new Error(
        withHelpRoute(
          `The URI target ${uri} does not support \`${action}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText("local-config-section", action, uri),
      kind: "help",
    };
  }
  if (!isLocalConfigAction(action)) {
    throw new Error(
      withHelpRoute(
        `The local config URI form does not support \`${action}\`. Pass the URI directly to read it, or use set, put, delete, clear, or test.`,
        helpRoute,
      ),
    );
  }

  return parseLocalConfigArguments(
    section,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
    helpRoute,
  );
}

function parseLocalConfigArguments(
  section: LocalConfigSection,
  action: CLILocalConfigAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  rejectLocalConfigFlags(action, values, helpRoute);

  switch (action) {
    case "get":
    case "clear":
    case "test":
      rejectArchiveExtraPositionals(action, tail, 0, helpRoute);
      break;
    case "delete":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      break;
    case "put":
      rejectArchiveExtraPositionals(
        action,
        tail,
        values.secret === true ? 1 : 2,
        helpRoute,
      );
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      if (
        values.secret !== true &&
        tail[1] === undefined &&
        values["json-input"] === undefined
      ) {
        throw new Error(withHelpRoute("Missing config value.", helpRoute));
      }
      break;
    case "set":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      break;
  }

  return {
    args: {
      action,
      ...(tail[0] === undefined || (action !== "put" && action !== "delete")
        ? {}
        : { key: tail[0] }),
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values["json-input"] === undefined
        ? {}
        : { jsonInputValue: values["json-input"] }),
      ...(action !== "set" && action !== "put"
        ? {}
        : tail[action === "put" ? 1 : 0] === undefined
          ? {}
          : { inputValue: tail[action === "put" ? 1 : 0] }),
      section,
      ...(values.secret === undefined ? {} : { secret: values.secret }),
    },
    help: false,
    kind: "local-config",
  };
}

function rejectLocalConfigFlags(
  action: CLILocalConfigAction,
  values: ArchiveArgumentValues,
  helpRoute: string,
): void {
  rejectMetaCommandFlag("input", values.input, helpRoute);
  rejectMetaCommandFlag("llm", values.llm, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("task", values.task, helpRoute);
  rejectMetaCommandBooleanFlag("jsonl", values.jsonl, helpRoute);
  rejectMetaCommandBooleanFlag("verbose", values.verbose, helpRoute);
  rejectCommandMetaFlags(values, action, helpRoute);

  if (values.secret === true && action !== "put") {
    throw new Error(
      withHelpRoute("`--secret` is only valid for config put.", helpRoute),
    );
  }
  if (action === "get" || action === "test") {
    return;
  }
  if (values.json === true && action !== "set" && action !== "put") {
    throw new Error(
      withHelpRoute(`\`${action}\` does not support --json.`, helpRoute),
    );
  }
}

function isLocalConfigAction(
  value: string | undefined,
): value is CLILocalConfigAction {
  return (
    value === "clear" ||
    value === "delete" ||
    value === "get" ||
    value === "put" ||
    value === "set" ||
    value === "test"
  );
}
