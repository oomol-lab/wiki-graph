import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import { renderMainHelpText } from "./help.js";

describe("cli/args/basic", () => {
  it("parses --version", () => {
    expect(parseCLIArguments(["--version"])).toStrictEqual({
      help: false,
      kind: "version",
    });
  });

  it("parses root help", () => {
    expect(parseCLIArguments(["--help"])).toMatchObject({
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    });
    expect(parseCLIArguments(["-h"])).toMatchObject({
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    });
  });

  it("renders URI predicate help", () => {
    const createHelp = parseCLIArguments([
      "wikg://book.wikg",
      "create",
      "--help",
    ]);
    const helpTopic = parseCLIArguments(["help", "recipe"]);

    expect(createHelp.help).toBe(true);
    expect(createHelp.kind).toBe("help");
    expect(helpTopic.help).toBe(true);
    expect(helpTopic.kind).toBe("help");
    if (!createHelp.help || createHelp.kind !== "help") {
      throw new Error("Expected create help");
    }
    if (!helpTopic.help || helpTopic.kind !== "help") {
      throw new Error("Expected help topic");
    }
    expect(createHelp.helpText).toContain("Command: wg <uri> create");
    expect(createHelp.helpText).toContain("Create the archive");
    expect(createHelp.helpText).toContain(
      "Existing archives are not overwritten by default",
    );
    expect(() => parseCLIArguments(["create", "--help"])).toThrow(
      "Unknown command: create.",
    );
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/unknown", "--help"]),
    ).toThrow(
      "Unknown Wiki Graph URI target: wikg://book.wikg/unknown. Use the archive root help or URI guide to choose a valid target.",
    );
  });

  it("renders archive-first create recipes", () => {
    const recipeHelp = parseCLIArguments(["help", "recipe"]);

    expect(recipeHelp.help).toBe(true);
    expect(recipeHelp.kind).toBe("help");
    if (!recipeHelp.help || recipeHelp.kind !== "help") {
      throw new Error("Expected recipe help");
    }
    expect(recipeHelp.helpText).toContain(
      "wg wikg://book.wikg create --import ./book.epub",
    );
    expect(recipeHelp.helpText).toContain(
      "cat chapter.txt | wg transform --input-format txt --output-format markdown",
    );
  });
});
