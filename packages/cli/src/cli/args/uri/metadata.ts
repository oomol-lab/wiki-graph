import { withHelpRoute } from "../../support/index.js";
import type {
  ArchiveArgumentValues,
  CLIArchiveUriAction,
  CLIMetadataAction,
  ParsedCLIArguments,
} from "../types.js";
import {
  rejectArchiveChapterMetaFlags,
  rejectArchiveMaintenanceExtraPositionals,
  rejectMetaCommandBooleanFlag,
  rejectMetaCommandFlag,
  stripObjectUriPrefix,
} from "../helpers.js";
import { isMetadataAction } from "../helpers.js";

export function parseMetadataUriArguments(
  archivePath: string,
  objectPath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (!isMetadataAction(action)) {
    throw new Error(
      withHelpRoute(
        `The metadata object does not support \`${action}\`. Read it directly, or use set, put, delete, or clear.`,
        "wg <object-uri>/meta --help",
      ),
    );
  }
  rejectMetadataFlags(action, values, helpRoute);

  switch (action) {
    case "get":
    case "clear":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 0, helpRoute);
      break;
    case "delete":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 1, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing metadata key.", helpRoute));
      }
      break;
    case "put":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 2, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing metadata key.", helpRoute));
      }
      break;
    case "set":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 1, helpRoute);
      break;
  }

  return {
    args: {
      action,
      archivePath,
      ...(values.input === undefined ? {} : { inputPath: values.input }),
      ...(action !== "set" && action !== "put"
        ? {}
        : tail[action === "put" ? 1 : 0] === undefined
          ? {}
          : { inputValue: tail[action === "put" ? 1 : 0] }),
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values["json-input"] === undefined
        ? {}
        : { jsonInputValue: values["json-input"] }),
      ...(tail[0] === undefined || (action !== "put" && action !== "delete")
        ? {}
        : { key: tail[0] }),
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      objectPath,
    },
    help: false,
    kind: "object-metadata",
  };
}

function rejectMetadataFlags(
  action: CLIMetadataAction,
  values: ArchiveArgumentValues,
  helpRoute: string,
): void {
  rejectMetaCommandFlag("budget", values.budget, helpRoute);
  rejectMetaCommandFlag("chapter", values.chapter, helpRoute);
  rejectMetaCommandFlag("cursor", values.cursor, helpRoute);
  rejectMetaCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectMetaCommandFlag("import", values.import, helpRoute);
  rejectMetaCommandFlag("input-format", values["input-format"], helpRoute);
  rejectMetaCommandFlag("limit", values.limit, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("output-format", values["output-format"], helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("stage", values.stage, helpRoute);
  rejectMetaCommandFlag("to", values.to, helpRoute);
  rejectMetaCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectMetaCommandBooleanFlag("jsonl", values.jsonl, helpRoute);
  rejectArchiveChapterMetaFlags(values, helpRoute);
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The metadata command does not support --verbose.",
        helpRoute,
      ),
    );
  }
  if (action === "get") {
    rejectMetaCommandFlag("input", values.input, helpRoute);
    rejectMetaCommandFlag("json-input", values["json-input"], helpRoute);
    return;
  }
  if (action === "clear" || action === "delete") {
    rejectMetaCommandFlag("input", values.input, helpRoute);
    rejectMetaCommandFlag("json-input", values["json-input"], helpRoute);
  }
}

export function parseMetadataTarget(objectUri: string): string | undefined {
  const path = stripObjectUriPrefix(objectUri);

  if (path === "meta") {
    return "";
  }
  if (!path.endsWith("/meta")) {
    return undefined;
  }

  return path.slice(0, -"/meta".length);
}

export function containsMetadataKeySuffix(objectUri: string): boolean {
  return /(?:^|\/)meta\/.+/u.test(stripObjectUriPrefix(objectUri));

}
