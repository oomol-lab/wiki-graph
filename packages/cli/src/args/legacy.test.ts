import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import { renderLegacyCommandHelpText } from "./help.js";

describe("cli/args/legacy", () => {
  it("parses legacy migration commands", () => {
    expect(parseCLIArguments(["legacy", "--help"])).toStrictEqual({
      help: true,
      helpText: renderLegacyCommandHelpText(),
      kind: "help",
    });
    expect(parseCLIArguments(["legacy", "migrate", "--help"])).toStrictEqual({
      help: true,
      helpText: renderLegacyCommandHelpText("migrate"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["legacy", "migrate", "book.sdpub"]),
    ).toStrictEqual({
      args: {
        action: "migrate",
        inputPath: "book.sdpub",
      },
      help: false,
      kind: "legacy",
    });
    expect(
      parseCLIArguments([
        "legacy",
        "migrate",
        "book.sdpub",
        "--output",
        "book.wikg",
      ]),
    ).toStrictEqual({
      args: {
        action: "migrate",
        inputPath: "book.sdpub",
        outputPath: "book.wikg",
      },
      help: false,
      kind: "legacy",
    });
    expect(() => parseCLIArguments(["book.sdpub"])).toThrow(
      "Unknown command: book.sdpub.",
    );
    expect(() => parseCLIArguments(["search", "book.sdpub", "query"])).toThrow(
      "Unknown command: search.",
    );
  });
});
