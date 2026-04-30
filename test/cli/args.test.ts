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
    expect(parseCLIArguments(["help", "env"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("env"),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "config-file"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("config-file"),
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
      "Unexpected positional arguments: book.epub. Use --input and --output instead.\nSee: spinedigest help command",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() => parseCLIArguments(["--input-format", "pdf"])).toThrow(
      "Invalid --input-format: pdf. Expected one of sdpub, epub, txt, markdown.\nSee: spinedigest help format",
    );
    expect(() => parseCLIArguments(["--output-format", "pdf"])).toThrow(
      "Invalid --output-format: pdf. Expected one of sdpub, epub, txt, markdown.\nSee: spinedigest help format",
    );
  });

  it("rejects invalid sdpub usage", () => {
    expect(() => parseCLIArguments(["sdpub"])).toThrow(
      "Missing sdpub subcommand. Expected one of info, toc, list, cat, cover.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "Invalid sdpub subcommand: inspect. Expected one of info, toc, list, cat, cover.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect", "extra"])).toThrow(
      "Unexpected positional arguments: extra.\nSee: spinedigest sdpub --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--output", "out.txt"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.\nSee: spinedigest sdpub --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--prompt", "Keep dialogue only"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --prompt. It only applies to digest generation from source inputs.\nSee: spinedigest sdpub --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "cat", "--input", "book.sdpub"]),
    ).toThrow(
      "Missing --serial. `spinedigest sdpub cat` requires it.\nSee: spinedigest sdpub cat --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "list",
        "--input",
        "book.sdpub",
        "--serial",
        "2",
      ]),
    ).toThrow(
      "The `sdpub list` subcommand does not support --serial.\nSee: spinedigest sdpub list --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--serial",
        "x",
      ]),
    ).toThrow(
      "Invalid --serial: x. Expected a non-negative integer.\nSee: spinedigest sdpub cat --help",
    );
  });

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of overview, task, command, format, config, env, config-file, runtime, recipe, troubleshoot, ai, sdpub.\nSee: spinedigest --help",
    );
    expect(() =>
      parseCLIArguments(["help", "task", "--input", "book.epub"]),
    ).toThrow(
      "The `help` command does not support --input.\nSee: spinedigest --help",
    );
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const sdpubHelpText = renderSdpubHelpText();
    const commandHelpText = renderHelpTopicText("command");

    expect(rootHelpText).toContain("spinedigest help [topic]");
    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest help env");
    expect(rootHelpText).toContain("spinedigest help config-file");
    expect(rootHelpText).toContain("spinedigest sdpub info --help");
    expect(rootHelpText).toContain("[--verbose|-v] [--help|-h]");
    expect(rootHelpText).toContain("`-h` is the short form of `--help`");
    expect(rootHelpText).toContain("`-v` is the short form of `--verbose`");
    expect(rootHelpText).toContain(
      "Append `--help` to any command or subcommand",
    );
    expect(rootHelpText).toContain("Treat `spinedigest --help` as the root");
    expect(rootHelpText).toContain(
      "Read `spinedigest help overview` for the product mental model.",
    );
    expect(rootHelpText).toContain("If a run fails:");
    expect(rootHelpText).toContain("Use `spinedigest help troubleshoot`");
    expect(renderHelpTopicText("runtime")).toContain("Runtime Behavior");
    expect(renderHelpTopicText("config")).toContain("Configuration Overview");
    expect(renderHelpTopicText("ai")).toContain("Suggested first pass:");
    expect(renderHelpTopicText("ai")).toContain(
      "Begin at `spinedigest --help`, which acts as the root page",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "Start with `spinedigest help overview`",
    );
    expect(commandHelpText).toContain("--verbose, -v");
    expect(commandHelpText).toContain("--help, -h");
    for (const flag of [
      "--input <path>",
      "--output <path>",
      "--input-format <format>",
      "--output-format <format>",
      "--digest-dir <path>",
      "--prompt <text>",
      "--serial <id>",
    ]) {
      expect(commandHelpText).toContain(flag);
    }
    expect(renderHelpTopicText("config")).toContain("spinedigest help env");
    expect(renderHelpTopicText("env")).toContain("SPINEDIGEST_LLM_MODEL");
    expect(renderHelpTopicText("env")).toContain("SPINEDIGEST_REQUEST_STREAM");
    expect(renderHelpTopicText("env")).toContain(
      "positive number or JSON number array such as `0.2` or `[0.2, 0.4]`",
    );
    expect(renderHelpTopicText("env")).toContain(
      "non-empty string (typically a URL) such as `https://api.example/v1`",
    );
    expect(renderHelpTopicText("config-file")).toContain(
      "~/.spinedigest/config.json",
    );
    expect(renderHelpTopicText("config-file")).toContain("llm.provider");
    expect(renderHelpTopicText("config-file")).toContain(
      'JSON string such as `"https://api.example/v1"`',
    );
    expect(renderHelpTopicText("config-file")).toContain(
      "positive number or JSON number array such as `0.9` or `[0.85, 0.9]`",
    );
    expect(renderHelpTopicText("config-file")).toContain(
      "JSON boolean, either `true` or `false`",
    );
    expect(sdpubHelpText).toContain("These subcommands do not call an LLM");
    expect(sdpubHelpText).toContain("[--help|-h]");
    expect(renderSdpubSubcommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderSdpubSubcommandHelpText("cover")).toContain("[--help|-h]");
  });

  it("supports a first-contact recovery chain from root help to parse failures", () => {
    const rootHelpText = renderMainHelpText();

    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest help command");
    expect(() => parseCLIArguments(["--input-format", "pdf"])).toThrow(
      "See: spinedigest help format",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "See: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "See: spinedigest help command",
    );
  });
});
