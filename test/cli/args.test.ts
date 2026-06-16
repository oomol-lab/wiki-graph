import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpTopicText,
  renderMainHelpText,
  renderStatusHelpText,
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
      parseCLIArguments(["config", "status", "--llm", '{"model":"cli-model"}']),
    ).toStrictEqual({
      args: {
        llmJSON: '{"model":"cli-model"}',
      },
      help: false,
      kind: "config-status",
    });
  });

  it("parses the transform command as direct digest", () => {
    expect(
      parseCLIArguments([
        "transform",
        "--input",
        "book.md",
        "--output-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        help: false,
        inputPath: "book.md",
        outputFormat: "markdown",
        verbose: false,
      },
      help: false,
      kind: "convert",
    });

    expect(parseCLIArguments(["transform", "--help"])).toMatchObject({
      help: true,
      kind: "convert",
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

    expect(
      parseCLIArguments([
        "find",
        "book.sdpub",
        "朱元璋 洪都",
        "--match",
        "all",
      ]),
    ).toStrictEqual({
      args: {
        action: "find",
        archivePath: "book.sdpub",
        match: "all",
        query: "朱元璋 洪都",
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["find", "book.sdpub", "RAG", "--match", "strict"]),
    ).toThrow("Invalid --match: strict. Expected any or all.");

    expect(
      parseCLIArguments([
        "grep",
        "book.sdpub",
        "exact phrase",
        "--chapter",
        "11,12",
        "--type",
        "summary,node",
        "--limit",
        "10",
        "--order",
        "doc-desc",
        "--cursor",
        "cursor-token",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "grep",
        archivePath: "book.sdpub",
        chapters: [11, 12],
        cursor: "cursor-token",
        json: true,
        limit: 10,
        query: "exact phrase",
        searchOrder: "doc-desc",
        searchTypes: ["summary", "node"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments([
        "grep",
        "book.sdpub",
        "exact phrase",
        "--match",
        "all",
      ]),
    ).toThrow("The `grep` command does not support --match.");

    expect(
      parseCLIArguments([
        "list",
        "book.sdpub",
        "--type",
        "chapter,node",
        "--chapter",
        "12,13",
        "--id",
        "chapter:12,node:320",
        "--limit",
        "20",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "book.sdpub",
        chapters: [12, 13],
        ids: ["chapter:12", "node:320"],
        json: true,
        limit: 20,
        searchTypes: ["chapter", "node"],
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["read", "book.sdpub", "chapter:12"]),
    ).toStrictEqual({
      args: {
        action: "read",
        archivePath: "book.sdpub",
        objectId: "chapter:12",
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["read", "book.sdpub", "chapter:12", "--json"]),
    ).toThrow("The `read` command does not support --json.");

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

  it("parses archive metadata and cover commands", () => {
    expect(parseCLIArguments(["meta", "book.sdpub", "--json"])).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        json: true,
      },
      help: false,
      kind: "meta",
    });
    expect(
      parseCLIArguments([
        "meta",
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
      },
      help: false,
      kind: "meta",
    });
    expect(parseCLIArguments(["cover", "book.sdpub"])).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
      },
      help: false,
      kind: "cover",
    });
  });

  it("parses archive chapter edit actions", () => {
    expect(
      parseCLIArguments([
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
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
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
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
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
      kind: "chapter",
    });
  });

  it("prints archive maintenance help pages", () => {
    expect(parseCLIArguments(["meta", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("meta"),
      kind: "maintenance",
    });
    expect(parseCLIArguments(["cover", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("cover"),
      kind: "maintenance",
    });
    expect(
      parseCLIArguments(["chapter", "set-summary", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderArchiveMaintenanceChapterActionHelpText("set-summary"),
      kind: "chapter",
    });
  });

  it("parses config status and prints config status help text", () => {
    expect(parseCLIArguments(["config", "status"])).toStrictEqual({
      args: {},
      help: false,
      kind: "config-status",
    });

    expect(parseCLIArguments(["config", "status", "--help"])).toStrictEqual({
      args: {},
      help: true,
      helpText: renderStatusHelpText(),
      kind: "config-status",
    });

    expect(parseCLIArguments(["status", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveCommandHelpText("status"),
      kind: "help",
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

  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unexpected positional argument or unknown command: book.epub. The direct digest command reads from stdin or --input; it does not accept positional input paths. Use `spinedigest transform --input <path>`, or see available subcommands with `spinedigest --help`.\nSee: spinedigest help command",
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

  it("rejects removed sdpub family and invalid maintenance usage", () => {
    expect(() => parseCLIArguments(["sdpub"])).toThrow(
      "Unexpected positional argument or unknown command: sdpub.",
    );
    expect(() => parseCLIArguments(["sdpub", "toc"])).toThrow(
      "Unexpected positional argument or unknown command: sdpub toc.",
    );
    expect(() => parseCLIArguments(["meta"])).toThrow(
      "Missing archive path. Use `spinedigest meta <archive.sdpub>`.",
    );
    expect(() =>
      parseCLIArguments(["meta", "book.sdpub", "--json", "--title", "Updated"]),
    ).toThrow(
      "`meta --json` is read-only and cannot be combined with metadata edit flags.",
    );
    expect(() => parseCLIArguments(["cover", "book.sdpub", "--json"])).toThrow(
      "The `cover` command does not support --json.",
    );
    expect(() =>
      parseCLIArguments([
        "chapter",
        "set-source",
        "book.sdpub",
        "--chapter",
        "x",
      ]),
    ).toThrow(
      "Invalid --chapter: x. Expected a non-negative integer.\nSee: spinedigest chapter --help",
    );
    expect(() =>
      parseCLIArguments([
        "chapter",
        "set-source",
        "book.sdpub",
        "--chapter",
        "1",
      ]),
    ).toThrow(
      "Missing --input-format. `chapter set-source` requires txt or markdown.\nSee: spinedigest chapter --help",
    );
    expect(() =>
      parseCLIArguments([
        "chapter",
        "reset",
        "book.sdpub",
        "--chapter",
        "1",
        "--to",
        "summarized",
      ]),
    ).toThrow(
      "`chapter reset` does not support --to summarized.\nSee: spinedigest chapter --help",
    );
  });

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of overview, task, command, format, config, env, config-file, runtime, recipe, troubleshoot, ai.\nSee: spinedigest --help",
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
      "Missing archive path. Use `spinedigest status <archive.sdpub>`.\nSee: spinedigest status --help",
    );
    expect(() => parseCLIArguments(["status", "--verbose"])).toThrow(
      "Missing archive path. Use `spinedigest status <archive.sdpub>`.\nSee: spinedigest status --help",
    );
    expect(() =>
      parseCLIArguments(["config", "status", "--input", "book.epub"]),
    ).toThrow(
      "The `config status` command does not support --input.\nSee: spinedigest config status --help",
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
    const commandHelpText = renderHelpTopicText("command");

    expect(rootHelpText).toContain("spinedigest help [topic]");
    expect(rootHelpText).toContain("spinedigest status <archive.sdpub>");
    expect(rootHelpText).toContain("spinedigest help overview");
    expect(rootHelpText).toContain("spinedigest help env");
    expect(rootHelpText).toContain("spinedigest help config-file");
    expect(rootHelpText).toContain("spinedigest meta <archive.sdpub>");
    expect(rootHelpText).toContain(
      "spinedigest chapter <action> <archive.sdpub>",
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
    expect(
      renderArchiveMaintenanceChapterActionHelpText("set-summary"),
    ).toContain("The chapter must be `graphed`");
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "[--help|-h]",
    );
    expect(renderArchiveMaintenanceCommandHelpText("meta")).toContain(
      "--clear-authors",
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
      "See: spinedigest help command",
    );
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "See: spinedigest help command",
    );
  });
});
