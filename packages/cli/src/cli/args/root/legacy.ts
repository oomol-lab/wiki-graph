import { renderLegacyCommandHelpText } from "../../help.js";
import { withHelpRoute } from "../../support/index.js";
import type { ArchiveArgumentValues, ParsedCLIArguments } from "../types.js";

export function parseLegacyArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const action = positionals[0];

  if (values.help === true && action === undefined) {
    return {
      help: true,
      helpText: renderLegacyCommandHelpText(),
      kind: "help",
    };
  }
  if (action === "migrate") {
    if (values.help === true) {
      return {
        help: true,
        helpText: renderLegacyCommandHelpText("migrate"),
        kind: "help",
      };
    }

    rejectLegacyFlag("--input", values.input);
    rejectLegacyFlag("--import", values.import);
    rejectLegacyFlag("--input-format", values["input-format"]);
    rejectLegacyFlag("--output-format", values["output-format"]);
    rejectLegacyFlag("--llm", values.llm);
    rejectLegacyFlag("--prompt", values.prompt);
    rejectLegacyBooleanFlag("--json", values.json);
    rejectLegacyBooleanFlag("--jsonl", values.jsonl);
    rejectLegacyBooleanFlag("--verbose", values.verbose);

    const inputPath = positionals[1];

    if (inputPath === undefined) {
      throw new Error(
        withHelpRoute("Missing legacy input path.", "wg legacy migrate --help"),
      );
    }
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          "wg legacy migrate --help",
        ),
      );
    }

    return {
      args: {
        action,
        inputPath,
        ...(values.output === undefined ? {} : { outputPath: values.output }),
      },
      help: false,
      kind: "legacy",
    };
  }

  throw new Error(
    withHelpRoute(
      action === undefined
        ? "Missing legacy command."
        : `Invalid legacy command: ${action}.`,
      "wg legacy --help",
    ),
  );
}

function rejectLegacyFlag(flag: string, value: unknown): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `\`wg legacy migrate\` does not support ${flag}.`,
        "wg legacy migrate --help",
      ),
    );
  }
}

function rejectLegacyBooleanFlag(
  flag: string,
  value: boolean | undefined,
): void {
  if (value === true) {
    rejectLegacyFlag(flag, value);
  }
}
