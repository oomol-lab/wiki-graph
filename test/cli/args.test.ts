import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderHelpTopicText,
  renderMainHelpText,
  renderStatusHelpText,
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
        "--llm",
        '{"model":"cli-model"}',
        "--prompt",
        "Keep named entities",
      ]),
    ).toStrictEqual({
      args: {
        digestDirPath: "/tmp/digest",
        help: true,
        inputFormat: "epub",
        inputPath: "book.epub",
        llmJSON: '{"model":"cli-model"}',
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

  it("parses short aliases -h and -v", () => {
    expect(parseCLIArguments(["-h"])).toMatchObject({
      help: true,
      kind: "convert",
    });

    expect(parseCLIArguments(["-v"])).toStrictEqual({
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

  it("parses --stage for sdpub output conversion", () => {
    expect(
      parseCLIArguments([
        "--input",
        "book.epub",
        "--output",
        "book.sdpub",
        "--stage",
        "sourced",
      ]),
    ).toStrictEqual({
      args: {
        help: false,
        inputPath: "book.epub",
        outputPath: "book.sdpub",
        targetStage: "sourced",
        verbose: false,
      },
      help: false,
      kind: "convert",
    });
  });

  it("parses --llm for runtime-configurable commands", () => {
    expect(parseCLIArguments(["--llm", '{"model":"cli-model"}'])).toStrictEqual(
      {
        args: {
          help: false,
          llmJSON: '{"model":"cli-model"}',
          verbose: false,
        },
        help: false,
        kind: "convert",
      },
    );

    expect(
      parseCLIArguments(["status", "--llm", '{"model":"cli-model"}']),
    ).toStrictEqual({
      args: {
        llmJSON: '{"model":"cli-model"}',
      },
      help: false,
      kind: "status",
    });
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
        "--llm",
        '{"model":"cli-model"}',
      ]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        llmJSON: '{"model":"cli-model"}',
        serialId: 12,
        subcommand: "cat",
      },
      help: false,
      kind: "sdpub",
    });
    expect(
      parseCLIArguments([
        "sdpub",
        "meta",
        "--input",
        "book.sdpub",
        "--title",
        "  Updated Book  ",
        "--author",
        "Ari Lantern",
        "--author",
        "Bea North",
        "--clear-description",
      ]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        metaPatch: {
          authors: ["Ari Lantern", "Bea North"],
          clearDescription: true,
          title: "Updated Book",
        },
        subcommand: "meta",
      },
      help: false,
      kind: "sdpub",
    });
  });

  it("parses sdpub chapter edit actions", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "chapter",
        "set-source",
        "book.sdpub",
        "--chapter",
        "12",
        "--input",
        "chapter.md",
        "--input-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-source",
        chapterId: 12,
        inputFormat: "markdown",
        inputPath: "chapter.md",
        path: "book.sdpub",
      },
      help: false,
      kind: "sdpub-chapter",
    });
    expect(
      parseCLIArguments([
        "sdpub",
        "chapter",
        "add",
        "book.sdpub",
        "--title",
        "Chapter 1",
        "--parent",
        "3",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        parentChapterId: 3,
        path: "book.sdpub",
        title: "Chapter 1",
      },
      help: false,
      kind: "sdpub-chapter",
    });
    expect(
      parseCLIArguments([
        "sdpub",
        "chapter",
        "reset",
        "book.sdpub",
        "--chapter",
        "12",
        "--to",
        "sourced",
      ]),
    ).toStrictEqual({
      args: {
        action: "reset",
        chapterId: 12,
        path: "book.sdpub",
        resetStage: "sourced",
      },
      help: false,
      kind: "sdpub-chapter",
    });
  });

  it("parses sdpub stage actions", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "stage",
        "advance",
        "book.sdpub",
        "--chapter",
        "3",
        "--to",
        "graphed",
        "--prompt",
        "Focus on claims",
      ]),
    ).toStrictEqual({
      args: {
        action: "advance",
        chapterId: 3,
        path: "book.sdpub",
        prompt: "Focus on claims",
        targetStage: "graphed",
      },
      help: false,
      kind: "sdpub-stage",
    });
    expect(
      parseCLIArguments(["sdpub", "stage", "pending", "book.sdpub"]),
    ).toStrictEqual({
      args: {
        action: "pending",
        path: "book.sdpub",
      },
      help: false,
      kind: "sdpub-stage",
    });
  });

  it("prints sdpub help text", () => {
    expect(parseCLIArguments(["sdpub", "--help"])).toStrictEqual({
      help: true,
      helpText: renderSdpubHelpText(),
      kind: "sdpub",
    });
  });

  it("parses status and prints status help text", () => {
    expect(parseCLIArguments(["status"])).toStrictEqual({
      args: {},
      help: false,
      kind: "status",
    });

    expect(parseCLIArguments(["status", "--help"])).toStrictEqual({
      args: {},
      help: true,
      helpText: renderStatusHelpText(),
      kind: "status",
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
      "Missing sdpub subcommand. Expected one of info, toc, list, cat, cover, meta, stage, chapter.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "Invalid sdpub subcommand: inspect. Expected one of info, toc, list, cat, cover, meta, stage, chapter.\nSee: spinedigest sdpub --help",
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
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "info",
        "--input",
        "book.sdpub",
        "--title",
        "Updated",
      ]),
    ).toThrow(
      "The `sdpub info` subcommand does not support metadata edit flags.\nSee: spinedigest sdpub info --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "meta",
        "--input",
        "book.sdpub",
        "--title",
        "Updated",
        "--clear-title",
      ]),
    ).toThrow(
      "Cannot combine --title with --clear-title.\nSee: spinedigest sdpub meta --help",
    );
  });

  it("rejects invalid sdpub chapter usage", () => {
    expect(() => parseCLIArguments(["sdpub", "chapter"])).toThrow(
      "Missing sdpub chapter action.\nSee: spinedigest sdpub chapter --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "chapter", "set-source", "book.sdpub"]),
    ).toThrow(
      "Missing --chapter. `sdpub chapter set-source` requires a chapter id.\nSee: spinedigest sdpub chapter --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "chapter",
        "set-source",
        "book.sdpub",
        "--chapter",
        "1",
      ]),
    ).toThrow(
      "Missing --input-format. `sdpub chapter set-source` requires txt or markdown.\nSee: spinedigest sdpub chapter --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "chapter",
        "reset",
        "book.sdpub",
        "--chapter",
        "1",
        "--to",
        "summarized",
      ]),
    ).toThrow(
      "`sdpub chapter reset` does not support --to summarized.\nSee: spinedigest sdpub chapter --help",
    );
  });

  it("rejects invalid sdpub stage usage", () => {
    expect(() => parseCLIArguments(["sdpub", "stage"])).toThrow(
      "Missing sdpub stage action.\nSee: spinedigest sdpub stage --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "stage",
        "advance",
        "book.sdpub",
        "--to",
        "x",
      ]),
    ).toThrow(
      "Invalid --to: x. Expected planned, sourced, graphed, or summarized.\nSee: spinedigest sdpub stage --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "stage",
        "pending",
        "book.sdpub",
        "--prompt",
        "unused",
      ]),
    ).toThrow(
      "The `sdpub stage pending` action does not support --prompt.\nSee: spinedigest sdpub stage --help",
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
    expect(() =>
      parseCLIArguments(["help", "overview", "--llm", '{"model":"cli-model"}']),
    ).toThrow(
      "The `help` command does not support --llm.\nSee: spinedigest --help",
    );
  });

  it("rejects invalid status usage", () => {
    expect(() => parseCLIArguments(["status", "--input", "book.epub"])).toThrow(
      "The `status` command does not support --input.\nSee: spinedigest status --help",
    );
    expect(() => parseCLIArguments(["status", "--verbose"])).toThrow(
      "The `status` command does not support --verbose.\nSee: spinedigest status --help",
    );
    expect(() => parseCLIArguments(["status", "extra"])).toThrow(
      "Unexpected positional arguments: extra.\nSee: spinedigest status --help",
    );
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const sdpubHelpText = renderSdpubHelpText();
    const commandHelpText = renderHelpTopicText("command");

    expect(rootHelpText).toContain("spinedigest help [topic]");
    expect(rootHelpText).toContain("spinedigest status [--llm <json>]");
    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest help env");
    expect(rootHelpText).toContain("spinedigest help config-file");
    expect(rootHelpText).toContain("spinedigest sdpub info --help");
    expect(rootHelpText).toContain("[--verbose|-v] [--help|-h]");
    expect(rootHelpText).toContain("[--stage <stage>]");
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
    expect(renderHelpTopicText("command")).toContain("spinedigest status");
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
      "--llm <json>",
      "--prompt <text>",
      "--serial <id>",
    ]) {
      expect(commandHelpText).toContain(flag);
    }
    expect(renderHelpTopicText("config")).toContain("spinedigest help env");
    expect(renderHelpTopicText("config")).toContain("Inline LLM JSON");
    expect(renderHelpTopicText("config")).toContain("baseUrl");
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
    expect(sdpubHelpText).toContain(
      "sdpub stage advance` calls an LLM provider",
    );
    expect(sdpubHelpText).toContain(
      "Inspection commands and metadata/tree edits do not call an LLM provider",
    );
    expect(sdpubHelpText).toContain("[--help|-h]");
    expect(renderSdpubSubcommandHelpText("stage")).toContain("advance <path>");
    expect(renderSdpubSubcommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderSdpubSubcommandHelpText("cover")).toContain("[--help|-h]");
    expect(renderSdpubSubcommandHelpText("meta")).toContain("--clear-authors");
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
