import { parseCLIFormat, withHelpRoute } from "../../support/index.js";
import { renderTransformHelpText } from "../../help.js";
import type { ArchiveArgumentValues, CLIArguments, ParsedCLIArguments } from "../types.js";
import { parseChapterStage, rejectTransformFlag, rejectTransformMetaFlags } from "../helpers.js";

export function parseTransformArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wg transform --help";

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }
  rejectTransformMetaFlags(values);
  rejectTransformFlag("budget", values.budget, helpRoute);
  rejectTransformFlag("chapter", values.chapter, helpRoute);
  rejectTransformFlag("confirm", values.confirm, helpRoute);
  rejectTransformFlag("cursor", values.cursor, helpRoute);
  rejectTransformFlag("evidence", values.evidence, helpRoute);
  rejectTransformFlag("json", values.json, helpRoute);
  rejectTransformFlag("import", values.import, helpRoute);
  rejectTransformFlag("limit", values.limit, helpRoute);
  rejectTransformFlag("parent", values.parent, helpRoute);
  rejectTransformFlag("to", values.to, helpRoute);

  const args = {
    ...(values["digest-dir"] === undefined
      ? {}
      : { digestDirPath: values["digest-dir"] }),
    help: values.help ?? false,
    ...(values.input === undefined ? {} : { inputPath: values.input }),
    ...(values["input-format"] === undefined
      ? {}
      : {
          inputFormat: parseCLIFormat(values["input-format"], "--input-format"),
        }),
    ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    ...(values.output === undefined ? {} : { outputPath: values.output }),
    ...(values["output-format"] === undefined
      ? {}
      : {
          outputFormat: parseCLIFormat(
            values["output-format"],
            "--output-format",
          ),
        }),
    ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
    ...(values.stage === undefined
      ? {}
      : {
          targetStage: parseChapterStage(values.stage, "--stage", helpRoute),
        }),
    verbose: values.verbose ?? false,
  } satisfies CLIArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText: renderTransformHelpText(),
      kind: "convert",
    };
  }

  return {
    args,
    help: false,
    kind: "convert",
  };
}
