import { renderGcCommandHelpText } from "../../help.js";
import { withHelpRoute } from "../../support/index.js";
import type { ArchiveArgumentValues, ArchiveMetaFlagValues, ParsedCLIArguments } from "../types.js";
import { rejectGcFlag, rejectGcMetaFlags } from "../helpers.js";

export function parseGcArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues & ArchiveMetaFlagValues,
): ParsedCLIArguments {
  const helpRoute = "wg gc --help";

  if (values.help === true) {
    return {
      help: true,
      helpText: renderGcCommandHelpText(),
      kind: "help",
    };
  }

  rejectGcFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectGcFlag("import", values.import, helpRoute);
  rejectGcFlag("input", values.input, helpRoute);
  rejectGcFlag("input-format", values["input-format"], helpRoute);
  rejectGcFlag("jsonl", values.jsonl, helpRoute);
  rejectGcFlag("limit", values.limit, helpRoute);
  rejectGcFlag("llm", values.llm, helpRoute);
  rejectGcFlag("output", values.output, helpRoute);
  rejectGcFlag("output-format", values["output-format"], helpRoute);
  rejectGcFlag("prompt", values.prompt, helpRoute);
  rejectGcFlag("stage", values.stage, helpRoute);
  rejectGcMetaFlags(values);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute("The `gc` command does not support --verbose.", helpRoute),
    );
  }
  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`gc\`: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: {
      ...(values["dry-run"] === undefined ? {} : { dryRun: values["dry-run"] }),
      ...(values.force === undefined ? {} : { force: values.force }),
      ...(values.json === undefined ? {} : { json: values.json }),
    },
    help: false,
    kind: "gc",
  };
}
