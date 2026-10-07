import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import {
  renderLibraryPredicateHelpText,
  renderLibraryUriHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
} from "./help.js";

describe("cli/args/archive index", () => {
  it("parses archive index object commands", () => {
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "sync", "--json"]),
    ).toThrow(
      "The `sync` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.",
    );
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "--reverse"]),
    ).toThrow("The `get` command does not support --reverse.");
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "sync", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "sync",
        archivePath: "/tmp/book.wikg",
        jsonl: true,
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "sync",
        "--jsonl",
        "--skip-unindexed",
      ]),
    ).toStrictEqual({
      args: {
        action: "sync",
        archivePath: "/tmp/book.wikg",
        jsonl: true,
        skipUnindexed: true,
      },
      help: false,
      kind: "archive-index",
    });
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "clean",
        "--skip-unindexed",
      ]),
    ).toThrow("The `clean` command does not support --skip-unindexed.");
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "sync",
        "--indexes",
        "fts",
      ]),
    ).toThrow(
      "The --indexes option has been removed. Build chapter index artifacts explicitly, then sync the archive or library index cache.",
    );
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg",
        "inspect",
        "--indexes",
        "fts",
      ]),
    ).toThrow(
      "The --indexes option has been removed. Build chapter index artifacts explicitly, then sync the archive or library index cache.",
    );
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123/index", "--json"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://lib/arc/archive123",
        json: true,
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123/index", "sync", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "sync",
        archivePath: "wikg://lib/arc/archive123",
        jsonl: true,
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "clean"]),
    ).toStrictEqual({
      args: {
        action: "clean",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive-index",
    });
    expect(
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "sync", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "index-object",
        "sync",
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
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "clean", "--dry-run"]),
    ).toThrow("The `clean` command does not support --dry-run.");
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "clean", "--jsonl"]),
    ).toThrow("The `clean` command does not support --jsonl.");
    expect(() =>
      parseCLIArguments([
        "wikg:///tmp/book.wikg/index",
        "clean",
        "--title",
        "x",
      ]),
    ).toThrow("The `clean` command does not support --title.");
    expect(() =>
      parseCLIArguments(["wikg:///tmp/book.wikg/index", "enable"]),
    ).toThrow(
      "The URI-first form does not support `enable`. Use `wg wikg:///tmp/book.wikg/index --help` to inspect valid predicates.",
    );
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
      parseCLIArguments(["wikg://lib/team/index", "sync", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "sync-index",
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
      parseCLIArguments(["wikg://lib/index", "clean", "--json"]),
    ).toStrictEqual({
      args: {
        action: "clean-index",
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
    expect(parseCLIArguments(["wikg://lib/index", "--help"])).toStrictEqual({
      help: true,
      helpText: renderLibraryUriHelpText("wikg://lib/index", {
        isDefault: true,
        kind: "scope",
        objectUri: "wikg://index",
      }),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/index", "sync", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/index",
        {
          isDefault: true,
          kind: "scope",
          objectUri: "wikg://index",
        },
        "sync",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/index", "clean", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/index",
        {
          isDefault: true,
          kind: "scope",
          objectUri: "wikg://index",
        },
        "clean",
      ),
      kind: "help",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/index", "sync", "--json"]),
    ).toThrow("Use --jsonl for line-delimited progress output.");
    expect(() =>
      parseCLIArguments(["wikg://lib/index", "sync", "--to", "x.wikg"]),
    ).toThrow("The `sync` command does not support --to.");
    expect(() => parseCLIArguments(["wikg://lib/index", "embed"])).toThrow(
      "The library index wikg://lib/index does not support `embed`.\nSee: wg wikg://lib/index --help",
    );
    expect(() => parseCLIArguments(["wikg://lib/index", "external"])).toThrow(
      "The library index wikg://lib/index does not support `external`.\nSee: wg wikg://lib/index --help",
    );
    expect(() => parseCLIArguments(["wikg://lib/team/index", "embed"])).toThrow(
      "The library index wikg://lib/team/index does not support `embed`.\nSee: wg wikg://lib/team/index --help",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib/team/index", "external"]),
    ).toThrow(
      "The library index wikg://lib/team/index does not support `external`.\nSee: wg wikg://lib/team/index --help",
    );
  });

  it("renders library v1 management help without routing to execution", () => {
    expect(
      parseCLIArguments(["wikg://lib/arc", "scan", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/arc",
        { isDefault: true, kind: "archive-collection" },
        "scan",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc", "add", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/arc",
        { isDefault: true, kind: "archive-collection" },
        "add",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123", "remove", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/arc/archive123",
        {
          archivePublicId: "archive123",
          isDefault: true,
          kind: "archive",
        },
        "remove",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123", "replace", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderLibraryPredicateHelpText(
        "wikg://lib/arc/archive123",
        {
          archivePublicId: "archive123",
          isDefault: true,
          kind: "archive",
        },
        "replace",
      ),
      kind: "help",
    });
  });

  it("parses atomic library archive replacement", () => {
    expect(
      parseCLIArguments([
        "wikg://lib/arc/archive123",
        "replace",
        "--input",
        "replacement.wikg",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "replace",
        inputPath: "replacement.wikg",
        json: true,
        target: {
          archivePublicId: "archive123",
          isDefault: true,
          kind: "archive",
        },
      },
      help: false,
      kind: "library",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/arc/archive123", "replace"]),
    ).toThrow("Missing --input <path>.");
  });

  it("renders library-wide object help through URI help templates", () => {
    expect(
      parseCLIArguments(["wikg://lib/entity/Q23", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText("entity-object", "wikg://lib/entity/Q23"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://lib/entity/Q23", "evidence", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "entity-object",
        "evidence",
        "wikg://lib/entity/Q23",
      ),
      kind: "help",
    });
  });

  it("parses library rebind only on library scope URIs", () => {
    expect(
      parseCLIArguments(["wikg://lib/path", "set", "/tmp/library"]),
    ).toStrictEqual({
      args: {
        action: "rebind",
        json: undefined,
        jsonl: undefined,
        path: "/tmp/library",
        target: { isDefault: true, kind: "scope" },
      },
      help: false,
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/team/path", "set", "/tmp/team", "--json"]),
    ).toStrictEqual({
      args: {
        action: "rebind",
        json: true,
        jsonl: undefined,
        path: "/tmp/team",
        target: { isDefault: false, kind: "scope", publicId: "team" },
      },
      help: false,
      kind: "library",
    });
    expect(() => parseCLIArguments(["wikg://lib/path", "set"])).toThrow(
      "Missing path value.",
    );
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123/path", "set", "x.wikg"]),
    ).toMatchObject({
      args: {
        action: "set",
        target: { archivePublicId: "archive123", kind: "archive-path" },
        to: "x.wikg",
      },
      kind: "library",
    });
    expect(
      parseCLIArguments([
        "wikg://lib/team/arc/archive123/path",
        "set",
        "x.wikg",
      ]),
    ).toMatchObject({
      args: {
        action: "set",
        target: {
          archivePublicId: "archive123",
          kind: "archive-path",
          publicId: "team",
        },
        to: "x.wikg",
      },
      kind: "library",
    });
  });
});
