import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import { renderGcCommandHelpText } from "./help.js";

describe("cli/args/gc", () => {
  it("parses gc commands", () => {
    expect(parseCLIArguments(["gc"])).toStrictEqual({
      args: {},
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--json"])).toStrictEqual({
      args: {
        json: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--force", "--json"])).toStrictEqual({
      args: {
        force: true,
        json: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--force", "--dry-run"])).toStrictEqual({
      args: {
        dryRun: true,
        force: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--help"])).toStrictEqual({
      help: true,
      helpText: renderGcCommandHelpText(),
      kind: "help",
    });
    expect(() => parseCLIArguments(["transform", "--force"])).toThrow(
      "The --force option is only supported by `gc`.",
    );
    expect(() => parseCLIArguments(["gc", "--jsonl"])).toThrow(
      "The `gc` command does not support --jsonl",
    );
  });
});
