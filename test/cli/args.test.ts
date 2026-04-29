import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderHelpTopicText,
  renderMainHelpText,
  renderSdpubHelpText,
  renderSdpubSubcommandHelpText,
} from "../../src/cli/help.js";

describe("cli/args", () => {
  it("parses help and io flags with normalized formats", () => {
    expect(
      parseCLIArguments([
        "--help",
        "--digest-dir",
        "/tmp/digest",
        "--input",
        "book.epub",
        "--input-format",
        " EPUB ",
        "--output",
        "out.txt",
        "--output-format",
        "markdown",
        "--prompt",
        "Keep named entities",
      ]),
    ).toStrictEqual({
      args: {
        digestDirPath: "/tmp/digest",
        help: true,
        inputFormat: "epub",
        inputPath: "book.epub",
        outputFormat: "markdown",
        outputPath: "out.txt",
        prompt: "Keep named entities",
        verbose: false,
      },
      help: true,
      helpText: renderMainHelpText(),
      kind: "convert",
    });
  });

  it("omits undefined optional arguments", () => {
    expect(parseCLIArguments([])).toStrictEqual({
      args: {
        help: false,
        verbose: false,
      },
      help: false,
      kind: "convert",
    });
  });

  it("parses --verbose", () => {
    expect(parseCLIArguments(["--verbose"])).toStrictEqual({
      args: {
        help: false,
        verbose: true,
      },
      help: false,
      kind: "convert",
    });
  });

  it("parses --prompt for the main convert command", () => {
    expect(parseCLIArguments(["--prompt", "Keep dialogue only"])).toStrictEqual(
      {
        args: {
          help: false,
          prompt: "Keep dialogue only",
          verbose: false,
        },
        help: false,
        kind: "convert",
      },
    );
  });

  it("parses sdpub subcommands", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--serial",
        "12",
      ]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        serialId: 12,
        subcommand: "cat",
      },
      help: false,
      kind: "sdpub",
    });
  });

  it("prints sdpub help text", () => {
    expect(parseCLIArguments(["sdpub", "--help"])).toStrictEqual({
      help: true,
      helpText: renderSdpubHelpText(),
      kind: "sdpub",
    });
  });

  it("prints help topic pages", () => {
    expect(parseCLIArguments(["help", "runtime"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("runtime"),
      kind: "help",
    });
  });

  it("prints sdpub subcommand help pages", () => {
    expect(parseCLIArguments(["sdpub", "info", "--help"])).toStrictEqual({
      help: true,
      helpText: renderSdpubSubcommandHelpText("info"),
      kind: "sdpub",
    });
  });

  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unexpected positional arguments: book.epub. Use --input and --output instead.",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() => parseCLIArguments(["--input-format", "pdf"])).toThrow(
      "Invalid --input-format: pdf. Expected one of sdpub, epub, txt, markdown.",
    );
    expect(() => parseCLIArguments(["--output-format", "pdf"])).toThrow(
      "Invalid --output-format: pdf. Expected one of sdpub, epub, txt, markdown.",
    );
  });

  it("rejects invalid sdpub usage", () => {
    expect(() => parseCLIArguments(["sdpub"])).toThrow(
      "Missing sdpub subcommand. Expected one of info, toc, list, cat, cover.",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "Invalid sdpub subcommand: inspect. Expected one of info, toc, list, cat, cover.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--output", "out.txt"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--prompt", "Keep dialogue only"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --prompt. It only applies to digest generation from source inputs.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "cat", "--input", "book.sdpub"]),
    ).toThrow("Missing --serial. `spinedigest sdpub cat` requires it.");
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "list",
        "--input",
        "book.sdpub",
        "--serial",
        "2",
      ]),
    ).toThrow("The `sdpub list` subcommand does not support --serial.");
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--serial",
        "x",
      ]),
    ).toThrow("Invalid --serial: x. Expected a non-negative integer.");
  });

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of overview, task, command, format, config, runtime, recipe, troubleshoot, ai, sdpub.",
    );
    expect(() =>
      parseCLIArguments(["help", "task", "--input", "book.epub"]),
    ).toThrow("The `help` command does not support --input.");
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const sdpubHelpText = renderSdpubHelpText();

    expect(rootHelpText).toContain("spinedigest help [topic]");
    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest sdpub info --help");
    expect(renderHelpTopicText("runtime")).toContain("Runtime Behavior");
    expect(renderHelpTopicText("config")).toContain("SPINEDIGEST_LLM_MODEL");
    expect(sdpubHelpText).toContain("These subcommands do not call an LLM");
    expect(renderSdpubSubcommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
  });
});
