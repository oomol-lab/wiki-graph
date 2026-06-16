import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderSdpubChapterActionHelpText,
  renderSdpubGraphActionHelpText,
  renderSdpubStageActionHelpText,
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

  it("parses --version", () => {
    expect(parseCLIArguments(["--version"])).toStrictEqual({
      help: false,
      kind: "version",
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

  it("renders archive command help", () => {
    const importHelp = parseCLIArguments(["import", "--help"]);
    const helpTopic = parseCLIArguments(["help", "import"]);

    expect(importHelp.help).toBe(true);
    expect(importHelp.kind).toBe("help");
    expect(helpTopic.help).toBe(true);
    expect(helpTopic.kind).toBe("help");
    if (!importHelp.help || importHelp.kind !== "help") {
      throw new Error("Expected import help");
    }
    if (!helpTopic.help || helpTopic.kind !== "help") {
      throw new Error("Expected help topic");
    }
    expect(importHelp.helpText).toContain("Command: spinedigest import");
    expect(helpTopic.helpText).toContain("stdin: supported");
  });

  it("renders archive-first stdin import recipes", () => {
    const recipeHelp = parseCLIArguments(["help", "recipe"]);

    expect(recipeHelp.help).toBe(true);
    expect(recipeHelp.kind).toBe("help");
    if (!recipeHelp.help || recipeHelp.kind !== "help") {
      throw new Error("Expected recipe help");
    }
    expect(recipeHelp.helpText).toContain(
      "cat article.md | spinedigest import article.sdpub --input-format markdown",
    );
    expect(recipeHelp.helpText).toContain("One-shot stream digest");
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

  it("parses archive-first commands", () => {
    expect(
      parseCLIArguments([
        "import",
        "book.sdpub",
        "book.md",
        "--input-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        action: "import",
        archivePath: "book.sdpub",
        inputFormat: "markdown",
        sourcePath: "book.md",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["import", "book.sdpub", "--input-format", "markdown"]),
    ).toStrictEqual({
      args: {
        action: "import",
        archivePath: "book.sdpub",
        inputFormat: "markdown",
      },
      help: false,
      kind: "archive",
    });

    expect(() =>
      parseCLIArguments(["build", "book.sdpub", "--stage", "graph"]),
    ).toThrow("This build may call an LLM.");
    expect(
      parseCLIArguments([
        "build",
        "book.sdpub",
        "--stage",
        "graph",
        "--confirm",
      ]),
    ).toStrictEqual({
      args: {
        action: "build",
        archivePath: "book.sdpub",
        confirm: true,
        targetStage: "graphed",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["find", "book.sdpub", "RAG", "--json"]),
    ).toStrictEqual({
      args: {
        action: "find",
        archivePath: "book.sdpub",
        json: true,
        query: "RAG",
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["ls", "book.sdpub", "nodes"])).toStrictEqual({
      args: {
        action: "ls",
        archivePath: "book.sdpub",
        listKind: "nodes",
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["ls", "book.sdpub", "fragments"])).toStrictEqual({
      args: {
        action: "ls",
        archivePath: "book.sdpub",
        listKind: "fragments",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["pack", "book.sdpub", "node:1", "--budget", "2000"]),
    ).toStrictEqual({
      args: {
        action: "pack",
        archivePath: "book.sdpub",
        budget: 2000,
        objectId: "node:1",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "path",
        "book.sdpub",
        "node:1",
        "node:2",
        "--chapter",
        "3",
      ]),
    ).toStrictEqual({
      args: {
        action: "path",
        archivePath: "book.sdpub",
        chapterId: 3,
        fromNodeId: 1,
        toNodeId: 2,
      },
      help: false,
      kind: "archive",
    });
  });

  it("parses sdpub subcommands", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--chapter",
        "12",
        "--llm",
        '{"model":"cli-model"}',
      ]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        llmJSON: '{"model":"cli-model"}',
        chapterId: 12,
        subcommand: "cat",
      },
      help: false,
      kind: "sdpub",
    });
    expect(
      parseCLIArguments(["sdpub", "list", "--input", "book.sdpub", "--json"]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        json: true,
        subcommand: "list",
      },
      help: false,
      kind: "sdpub",
    });
    expect(
      parseCLIArguments(["sdpub", "meta", "--input", "book.sdpub", "--json"]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        json: true,
        subcommand: "meta",
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

  it("parses sdpub graph actions", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "graph",
        "log",
        "book.sdpub",
        "--chapter",
        "2",
        "--limit",
        "5",
        "--llm",
        '{"model":"cli-model"}',
      ]),
    ).toStrictEqual({
      args: {
        action: "log",
        chapterId: 2,
        limit: 5,
        llmJSON: '{"model":"cli-model"}',
        path: "book.sdpub",
      },
      help: false,
      kind: "sdpub-graph",
    });
    expect(
      parseCLIArguments([
        "sdpub",
        "graph",
        "show",
        "book.sdpub",
        "--chapter",
        "2",
        "9",
      ]),
    ).toStrictEqual({
      args: {
        action: "show",
        chapterId: 2,
        nodeId: 9,
        path: "book.sdpub",
      },
      help: false,
      kind: "sdpub-graph",
    });
    expect(
      parseCLIArguments([
        "sdpub",
        "graph",
        "path",
        "book.sdpub",
        "--chapter",
        "2",
        "9",
        "11",
      ]),
    ).toStrictEqual({
      args: {
        action: "path",
        chapterId: 2,
        fromNodeId: 9,
        path: "book.sdpub",
        toNodeId: 11,
      },
      help: false,
      kind: "sdpub-graph",
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
    expect(
      parseCLIArguments(["sdpub", "chapter", "set-summary", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderSdpubChapterActionHelpText("set-summary"),
      kind: "sdpub-chapter",
    });
    expect(
      parseCLIArguments(["sdpub", "stage", "advance", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderSdpubStageActionHelpText("advance"),
      kind: "sdpub-stage",
    });
    expect(
      parseCLIArguments(["sdpub", "graph", "show", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderSdpubGraphActionHelpText("show"),
      kind: "sdpub-graph",
    });
  });

  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unexpected positional argument or unknown command: book.epub. The default command reads from stdin or --input; it does not accept positional input paths. Use --input <path>, or see available subcommands with `spinedigest --help`.\nSee: spinedigest help command",
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
      "Missing sdpub subcommand. Expected one of info, toc, list, cat, cover, meta, stage, chapter, graph.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "Invalid sdpub subcommand: inspect. Expected one of info, toc, list, cat, cover, meta, stage, chapter, graph.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect", "extra"])).toThrow(
      "Unexpected positional arguments: extra.\nSee: spinedigest sdpub --help",
    );
    expect(() => parseCLIArguments(["sdpub", "info", "book.sdpub"])).toThrow(
      "Unexpected positional arguments: book.sdpub. The `sdpub info` subcommand uses --input <path>; it does not accept a positional archive path.\nSee: spinedigest sdpub info --help",
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
      parseCLIArguments(["sdpub", "info", "--input", "book.sdpub", "--json"]),
    ).toThrow(
      "The `sdpub info` subcommand does not support --json.\nSee: spinedigest sdpub info --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "meta",
        "--input",
        "book.sdpub",
        "--json",
        "--title",
        "Updated",
      ]),
    ).toThrow(
      "`sdpub meta --json` is read-only and cannot be combined with metadata edit flags.\nSee: spinedigest sdpub meta --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "cat", "--input", "book.sdpub"]),
    ).toThrow(
      "Missing --chapter. `spinedigest sdpub cat` requires a chapter id.\nSee: spinedigest sdpub cat --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "list",
        "--input",
        "book.sdpub",
        "--chapter",
        "2",
      ]),
    ).toThrow(
      "The `sdpub list` subcommand does not support --chapter.\nSee: spinedigest sdpub list --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--chapter",
        "x",
      ]),
    ).toThrow(
      "Invalid --chapter: x. Expected a non-negative integer.\nSee: spinedigest sdpub cat --help",
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

  it("rejects invalid sdpub graph usage", () => {
    expect(() => parseCLIArguments(["sdpub", "graph"])).toThrow(
      "Missing sdpub graph action.\nSee: spinedigest sdpub graph --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "graph", "bogus", "book.sdpub"]),
    ).toThrow(
      "Invalid sdpub graph action: bogus. Expected one of status, log, show, grep, neighbors, blame, path.\nSee: spinedigest sdpub graph --help",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "graph", "log", "book.sdpub"]),
    ).toThrow(
      "Missing --chapter. `sdpub graph` requires a chapter id.\nSee: spinedigest sdpub graph --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "graph",
        "show",
        "book.sdpub",
        "--chapter",
        "2",
      ]),
    ).toThrow(
      "`sdpub graph show` requires exactly one node id.\nSee: spinedigest sdpub graph --help",
    );
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "graph",
        "status",
        "book.sdpub",
        "--chapter",
        "2",
        "--limit",
        "5",
      ]),
    ).toThrow(
      "The `sdpub graph status` action does not support --limit.\nSee: spinedigest sdpub graph --help",
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
    expect(parseCLIArguments(["status", "book.sdpub"])).toStrictEqual({
      args: {
        action: "status",
        archivePath: "book.sdpub",
      },
      help: false,
      kind: "archive",
    });
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const sdpubHelpText = renderSdpubHelpText();
    const commandHelpText = renderHelpTopicText("command");

    expect(rootHelpText).toContain("spinedigest help [topic]");
    expect(rootHelpText).toContain("spinedigest status <archive.sdpub>");
    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest help env");
    expect(rootHelpText).toContain("spinedigest help config-file");
    expect(rootHelpText).toContain(
      "spinedigest sdpub <info|toc|list|cat|cover|meta>",
    );
    expect(rootHelpText).toContain("[--verbose|-v] [--help|-h]");
    expect(rootHelpText).toContain("chapter:<id>");
    expect(rootHelpText).toContain(
      "Append `--help` to commands and subcommands",
    );
    expect(rootHelpText).toContain("Treat `spinedigest --help` as the root");
    expect(rootHelpText).toContain(
      "Read `spinedigest help overview` for the archive-first mental model.",
    );
    expect(rootHelpText).toContain("Build can call an LLM");
    expect(renderHelpTopicText("runtime")).toContain("Runtime Behavior");
    expect(renderHelpTopicText("config")).toContain("Configuration Overview");
    expect(renderHelpTopicText("command")).toContain("spinedigest status");
    expect(renderHelpTopicText("ai")).toContain("Primary contract:");
    expect(renderHelpTopicText("ai")).toContain(
      "Treat `.sdpub` as an LLM Wiki archive",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "spinedigest estimate <archive.sdpub> --stage ready",
    );
    expect(commandHelpText).toContain("Archive-first commands:");
    expect(commandHelpText).toContain("spinedigest import <archive.sdpub>");
    expect(commandHelpText).toContain("spinedigest export <archive.sdpub>");
    for (const flag of [
      "--input <path>",
      "--output <path>",
      "--input-format <format>",
      "--output-format <format>",
      "--digest-dir <path>",
      "--llm <json>",
      "--prompt <text>",
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
    expect(renderSdpubStageActionHelpText("advance")).toContain(
      "Advancement is idempotent",
    );
    expect(renderSdpubChapterActionHelpText("set-summary")).toContain(
      "The chapter must be `graphed`",
    );
    expect(renderSdpubSubcommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderSdpubSubcommandHelpText("cover")).toContain("[--help|-h]");
    expect(renderSdpubSubcommandHelpText("meta")).toContain("--clear-authors");
    expect(renderHelpTopicText("sdpub")).toContain(
      "agents should not unzip it or read `database.db` directly",
    );
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
expect(() =>
  parseCLIArguments(["sdpub", "chapter", "bogus", "--help"]),
).toThrow(
  "Invalid sdpub chapter action: bogus. Expected one of list, status, add, remove, reset, set-source, set-summary.\nSee: spinedigest sdpub chapter --help",
);
expect(() => parseCLIArguments(["sdpub", "stage", "bogus", "--help"])).toThrow(
  "Invalid sdpub stage action: bogus. Expected one of advance, pending.\nSee: spinedigest sdpub stage --help",
);
