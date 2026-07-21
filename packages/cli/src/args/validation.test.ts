import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";

describe("cli/args/validation", () => {
  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unknown command: book.epub.\nSee: wg --help",
    );
    expect(() => parseCLIArguments(["book.wikg", "search", "RAG"])).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: book.wikg\nUse: wikg://book.wikg\nSee: wg help uri",
    );
    expect(() =>
      parseCLIArguments(["/Users/me/book.wikg/chapter/12", "get"]),
    ).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: /Users/me/book.wikg/chapter/12\nUse: wikg:///Users/me/book.wikg/chapter/12\nSee: wg help uri",
    );
    expect(() =>
      parseCLIArguments(["C:\\books\\book.wikg\\chapter\\12", "get"]),
    ).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: C:\\books\\book.wikg\\chapter\\12\nUse: wikg://C:/books/book.wikg/chapter/12\nSee: wg help uri",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--import", "pdf"]),
    ).toThrow(
      "`create --import` only supports EPUB input.\nSee: wg wikg://book.wikg create --help",
    );
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "export",
        "--output-format",
        "pdf",
      ]),
    ).toThrow(
      "Invalid --output-format: pdf. Expected one of wikg, epub, txt, markdown.\nSee: wg help format",
    );
  });

  it("rejects removed command families and invalid maintenance usage", () => {
    expect(() => parseCLIArguments([])).toThrow(
      "Missing command.\nSee: wg --help",
    );
    expect(() => parseCLIArguments(["import", "--help"])).toThrow(
      "Unknown command: import.\nSee: wg --help",
    );
    expect(() => parseCLIArguments(["ls", "book.wikg"])).toThrow(
      "Unknown command: ls.\nSee: wg --help",
    );
    expect(() => parseCLIArguments(["wikg"])).toThrow("Unknown command: wikg.");
    expect(() => parseCLIArguments(["wikg", "toc"])).toThrow(
      "Unknown command: wikg.",
    );
    expect(() => parseCLIArguments(["meta"])).toThrow("Unknown command: meta.");
    expect(() => parseCLIArguments(["chapter", "set", "--help"])).toThrow(
      "Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.",
    );
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/",
        "set",
        "--json",
        "--title",
        "Updated",
      ]),
    ).toThrow("archive URI form does not support `set`");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/cover", "--json"]),
    ).toThrow("The `cover` command does not support --json.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/x/source", "set"]),
    ).toThrow(
      "Use `wg wikg://book.wikg/chapter/x/source --help` to inspect valid predicates.",
    );
    expect(() => parseCLIArguments(["wikg://entity/Q9957"])).toThrow(
      "Short object URIs from output are archive-relative handles.",
    );
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/1/source", "set"]),
    ).not.toThrow();
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/1/source",
        "set",
        "--jsonl",
      ]),
    ).toThrow(
      "The `chapter` command does not support --jsonl.\nSee: wg wikg://book.wikg/chapter/1/source set --help",
    );
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/1",
        "reset",
        "--to",
        "summarized",
      ]),
    ).toThrow(
      "Invalid --to: summarized. Expected planned, source, or reading-graph.\nSee: wg wikg://book.wikg/chapter/1 reset --help",
    );
  });
});
