import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import { renderUriPredicateHelpText } from "./help.js";

describe("cli/args/archive index", () => {
  it("parses archive index object commands", () => {
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "enable", "--json"]),
    ).toThrow(
      "The `enable` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.",
    );
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "--reverse"]),
    ).toThrow("The `get` command does not support --reverse.");
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "enable", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "enable",
        archivePath: "/tmp/book.wikg",
        jsonl: true,
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "external"]),
    ).toStrictEqual({
      args: {
        action: "external",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "enable", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "index-object",
        "enable",
        "wikg:///tmp/book.wikg/index",
      ),
      kind: "help",
    });
    expect(() => parseCLIArguments(["help", "index"])).toThrow(
      "Invalid help topic: index.",
    );
    expect(() => parseCLIArguments(["help", "build"])).toThrow(
      "Invalid help topic: build.",
    );
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "disable",
        "--dry-run",
      ]),
    ).toThrow("The `disable` command does not support --dry-run.");
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "disable", "--jsonl"]),
    ).toThrow("The `disable` command does not support --jsonl.");
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "disable",
        "--title",
        "x",
      ]),
    ).toThrow("The `disable` command does not support --title.");
  });

  it("parses library index object commands", () => {
    expect(parseCLIArguments(["wikg://lib/index"])).toStrictEqual({
      args: {
        action: "get-index",
        target: {
          isDefault: true,
          kind: "scope",
          objectUri: "wikg://index",
        },
      },
      help: false,
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/team.lib/index", "enable", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "enable-index",
        jsonl: true,
        target: {
          isDefault: false,
          kind: "scope",
          objectUri: "wikg://index",
          publicId: "team",
        },
      },
      help: false,
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/index", "disable", "--json"]),
    ).toStrictEqual({
      args: {
        action: "disable-index",
        json: true,
        target: {
          isDefault: true,
          kind: "scope",
          objectUri: "wikg://index",
        },
      },
      help: false,
      kind: "library",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/index", "enable", "--json"]),
    ).toThrow("Use --jsonl for line-delimited progress output.");
    expect(() =>
      parseCLIArguments(["wikg://lib/index", "enable", "--to", "x.wikg"]),
    ).toThrow("The `enable` command does not support --to.");
    expect(() => parseCLIArguments(["wikg://lib/index", "embed"])).toThrow(
      "The library index wikg://lib/index does not support `embed`.\nSee: wg wikg://lib/index embed --help",
    );
    expect(() => parseCLIArguments(["wikg://lib/index", "external"])).toThrow(
      "The library index wikg://lib/index does not support `external`.\nSee: wg wikg://lib/index external --help",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib/team.lib/index", "embed"]),
    ).toThrow(
      "The library index wikg://lib/team.lib/index does not support `embed`.\nSee: wg wikg://lib/team.lib/index embed --help",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib/team.lib/index", "external"]),
    ).toThrow(
      "The library index wikg://lib/team.lib/index does not support `external`.\nSee: wg wikg://lib/team.lib/index external --help",
    );
  });
});
