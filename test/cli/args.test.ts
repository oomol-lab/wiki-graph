import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpTopicText,
  renderMainHelpText,
  renderQueueCommandHelpText,
  renderStatusHelpText,
  renderTransformHelpText,
} from "../../src/cli/help.js";

describe("cli/args", () => {
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

  it("renders archive command help", () => {
    const createHelp = parseCLIArguments(["create", "--help"]);
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
    expect(createHelp.helpText).toContain("Command: spinedigest create");
    expect(createHelp.helpText).toContain("stdin: supported");
  });

  it("renders archive-first stdin create recipes", () => {
    const recipeHelp = parseCLIArguments(["help", "recipe"]);

    expect(recipeHelp.help).toBe(true);
    expect(recipeHelp.kind).toBe("help");
    if (!recipeHelp.help || recipeHelp.kind !== "help") {
      throw new Error("Expected recipe help");
    }
    expect(recipeHelp.helpText).toContain(
      "cat article.md | spinedigest create article.sdpub --input-format markdown",
    );
    expect(recipeHelp.helpText).toContain(
      "cat chapter.txt | spinedigest transform --input-format txt --output-format markdown",
    );
  });

  it("parses --llm for runtime-configurable commands", () => {
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

  it("parses queue commands", () => {
    expect(
      parseCLIArguments([
        "queue",
        "add",
        "book.sdpub",
        "--chapter",
        "12",
        "--to",
        "summary",
        "--boost",
        "--accept-cost",
        "--llm",
        '{"model":"cli-model"}',
      ]),
    ).toStrictEqual({
      args: {
        acceptCost: true,
        action: "add",
        archivePath: "book.sdpub",
        boost: true,
        chapterId: 12,
        llmJSON: '{"model":"cli-model"}',
        target: "summary",
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments([
        "queue",
        "add",
        "book.sdpub",
        "--chapter",
        "12",
        "--to",
        "summary",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath: "book.sdpub",
        chapterId: 12,
        target: "summary",
      },
      help: false,
      kind: "queue",
    });
    expect(() =>
      parseCLIArguments(["status", "book.sdpub", "--accept-cost"]),
    ).toThrow("only valid for `spinedigest queue add`");

    expect(
      parseCLIArguments([
        "queue",
        "watch",
        "job-1",
        "--jsonl",
        "--from",
        "now",
      ]),
    ).toStrictEqual({
      args: {
        action: "watch",
        from: "now",
        jobId: "job-1",
        jsonl: true,
      },
      help: false,
      kind: "queue",
    });

    expect(parseCLIArguments(["queue", "list", "--json"])).toStrictEqual({
      args: {
        action: "list",
        json: true,
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments(["queue", "status", "job-1", "--json"]),
    ).toStrictEqual({
      args: {
        action: "status",
        jobId: "job-1",
        json: true,
      },
      help: false,
      kind: "queue",
    });

    expect(parseCLIArguments(["queue", "--help"])).toStrictEqual({
      help: true,
      helpText: renderQueueCommandHelpText(),
      kind: "help",
    });

    expect(parseCLIArguments(["queue", "list", "--help"])).toStrictEqual({
      help: true,
      helpText: renderQueueCommandHelpText("list"),
      kind: "help",
    });

    expect(() =>
      parseCLIArguments(["queue", "watch", "job-1", "--json"]),
    ).toThrow("does not support --json");
    expect(() => parseCLIArguments(["queue", "list", "--jsonl"])).toThrow(
      "does not support --jsonl",
    );
  });

  it("parses the transform command as direct digest", () => {
    expect(
      parseCLIArguments([
        "transform",
        "--input",
        "book.md",
        "--output-format",
        "markdown",
        "--prompt",
        "Keep dialogue only",
        "--verbose",
      ]),
    ).toStrictEqual({
      args: {
        help: false,
        inputPath: "book.md",
        outputFormat: "markdown",
        prompt: "Keep dialogue only",
        verbose: true,
      },
      help: false,
      kind: "convert",
    });

    expect(
      parseCLIArguments([
        "transform",
        "--input",
        "book.epub",
        "--output",
        "book.sdpub",
        "--stage",
        "source",
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

    expect(parseCLIArguments(["transform", "--help"])).toStrictEqual({
      args: {
        help: true,
        verbose: false,
      },
      help: true,
      helpText: renderTransformHelpText(),
      kind: "convert",
    });
  });

  it("parses archive-first commands", () => {
    expect(
      parseCLIArguments([
        "create",
        "book.sdpub",
        "book.md",
        "--input-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: "book.sdpub",
        inputFormat: "markdown",
        sourcePath: "book.md",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["create", "book.sdpub", "--input-format", "markdown"]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: "book.sdpub",
        inputFormat: "markdown",
      },
      help: false,
      kind: "archive",
    });

    expect(() => parseCLIArguments(["build", "book.sdpub"])).toThrow(
      "Unknown command: build.",
    );

    expect(
      parseCLIArguments([
        "find",
        "book.sdpub",
        "RAG",
        "--type",
        "node",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "find",
        archivePath: "book.sdpub",
        json: true,
        query: "RAG",
        searchTypes: ["node"],
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "find",
        "book.sdpub",
        "朱元璋 洪都",
        "--type",
        "summary",
        "--match",
        "all",
      ]),
    ).toStrictEqual({
      args: {
        action: "find",
        archivePath: "book.sdpub",
        match: "all",
        query: "朱元璋 洪都",
        searchTypes: ["summary"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["find", "book.sdpub", "RAG", "--match", "strict"]),
    ).toThrow("--type is required.");

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
        "--type",
        "node",
        "--match",
        "all",
      ]),
    ).toThrow("The `grep` command does not support --match.");

    expect(
      parseCLIArguments([
        "list",
        "book.sdpub",
        "--type",
        "node",
        "--chapter",
        "12,13",
        "--id",
        "320,321",
        "--limit",
        "20",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "book.sdpub",
        chapters: [12, 13],
        ids: ["node:320", "node:321"],
        json: true,
        limit: 20,
        searchTypes: ["node"],
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["read", "book.sdpub", "--chapter", "12"]),
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
      parseCLIArguments(["read", "book.sdpub", "--chapter", "12", "--json"]),
    ).toThrow("The `read` command does not support --json.");

    expect(
      parseCLIArguments([
        "pack",
        "book.sdpub",
        "--node",
        "1",
        "--budget",
        "2000",
      ]),
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
        "--from",
        "1",
        "--to",
        "2",
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

    expect(() => parseCLIArguments(["list", "book.sdpub"])).toThrow(
      "--type is required.",
    );
    expect(() =>
      parseCLIArguments([
        "list",
        "book.sdpub",
        "--type",
        "node,chapter",
        "--id",
        "1",
      ]),
    ).toThrow("requires exactly one --type");
    expect(() => parseCLIArguments(["page", "book.sdpub", "node:1"])).toThrow(
      "Unexpected positional arguments for `page`: node:1.",
    );
    expect(() =>
      parseCLIArguments(["page", "book.sdpub", "--node", "1", "--from", "2"]),
    ).toThrow("The `page` command does not support --from.");
    expect(() =>
      parseCLIArguments(["links", "book.sdpub", "--chapter", "1"]),
    ).toThrow("The `links` command does not support --chapter.");
    expect(() =>
      parseCLIArguments(["path", "book.sdpub", "--chapter", "3"]),
    ).toThrow("spinedigest path requires --from.");
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
        "--stage",
        "planned",
        "--title",
        "Chapter 1",
        "--parent",
        "3",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        addStage: "planned",
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
        "move",
        "book.sdpub",
        "--chapter",
        "8",
        "--parent",
        "3",
        "--first",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterId: 8,
        first: true,
        parentChapterId: 3,
        path: "book.sdpub",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "chapter",
        "move",
        "book.sdpub",
        "--chapter",
        "8",
        "--root",
        "--last",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterId: 8,
        last: true,
        moveToRoot: true,
        path: "book.sdpub",
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
        "source",
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
    expect(
      parseCLIArguments([
        "chapter",
        "set-title",
        "book.sdpub",
        "--chapter",
        "12",
        "--clear",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterId: 12,
        clearTitle: true,
        path: "book.sdpub",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments(["chapter", "tree", "book.sdpub", "--json"]),
    ).toStrictEqual({
      args: {
        action: "tree",
        json: true,
        path: "book.sdpub",
        treeAction: "show",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "chapter",
        "tree",
        "apply",
        "book.sdpub",
        "--input",
        "tree.json",
        "--dry-run",
      ]),
    ).toStrictEqual({
      args: {
        action: "tree",
        dryRun: true,
        inputPath: "tree.json",
        path: "book.sdpub",
        treeAction: "apply",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "chapter",
        "tree",
        "apply",
        "book.sdpub",
        "--dry-run",
      ]),
    ).toStrictEqual({
      args: {
        action: "tree",
        dryRun: true,
        path: "book.sdpub",
        treeAction: "apply",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "chapter",
        "set-title",
        "book.sdpub",
        "--chapter",
        "12",
        "--title",
        "Renamed Chapter",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterId: 12,
        path: "book.sdpub",
        title: "Renamed Chapter",
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "chapter",
        "move",
        "book.sdpub",
        "--chapter",
        "8",
        "--parent",
        "3",
        "--root",
      ]),
    ).toThrow("Choose only one parent target");
    expect(() =>
      parseCLIArguments([
        "chapter",
        "set-title",
        "book.sdpub",
        "--chapter",
        "12",
        "--title",
        "Title",
        "--clear",
      ]),
    ).toThrow("cannot combine --title with --clear");
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
    expect(parseCLIArguments(["chapter", "set-title", "--help"])).toStrictEqual(
      {
        help: true,
        helpText: renderArchiveMaintenanceChapterActionHelpText("set-title"),
        kind: "chapter",
      },
    );
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
      "Unknown command: book.epub.\nSee: spinedigest help command",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() =>
      parseCLIArguments([
        "create",
        "book.sdpub",
        "book.md",
        "--input-format",
        "pdf",
      ]),
    ).toThrow(
      "Invalid --input-format: pdf. Expected one of sdpub, epub, txt, markdown.\nSee: spinedigest help format",
    );
    expect(() =>
      parseCLIArguments(["export", "book.sdpub", "--output-format", "pdf"]),
    ).toThrow(
      "Invalid --output-format: pdf. Expected one of sdpub, epub, txt, markdown.\nSee: spinedigest help format",
    );
  });

  it("rejects removed command families and invalid maintenance usage", () => {
    expect(() => parseCLIArguments([])).toThrow(
      "Missing command.\nSee: spinedigest help command",
    );
    expect(() => parseCLIArguments(["import", "--help"])).toThrow(
      "Unknown command: import.\nSee: spinedigest help command",
    );
    expect(() => parseCLIArguments(["ls", "book.sdpub"])).toThrow(
      "Unknown command: ls.\nSee: spinedigest help command",
    );
    expect(() => parseCLIArguments(["sdpub"])).toThrow(
      "Unknown command: sdpub.",
    );
    expect(() => parseCLIArguments(["sdpub", "toc"])).toThrow(
      "Unknown command: sdpub.",
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
      "Invalid --to: summarized. Expected planned, source, or graph.\nSee: spinedigest chapter --help",
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
    expect(rootHelpText).toContain("spinedigest transform");
    expect(rootHelpText).not.toContain("spinedigest import");
    expect(rootHelpText).toContain("--chapter <id>");
    expect(rootHelpText).toContain(
      "Append `--help` to commands and subcommands",
    );
    expect(rootHelpText).toContain("Treat `spinedigest --help` as the root");
    expect(rootHelpText).toContain(
      "Read `spinedigest help overview` for the archive-first mental model.",
    );
    expect(rootHelpText).toContain("Queue graph and summary jobs call an LLM");
    expect(renderHelpTopicText("runtime")).toContain("Runtime Behavior");
    expect(renderHelpTopicText("config")).toContain("Configuration Overview");
    expect(renderHelpTopicText("command")).toContain("spinedigest status");
    expect(renderHelpTopicText("ai")).toContain("Primary contract:");
    expect(renderHelpTopicText("ai")).toContain(
      "Treat `.sdpub` as an LLM Wiki archive",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "spinedigest estimate <archive.sdpub> --stage summary",
    );
    expect(commandHelpText).toContain("Archive-first commands:");
    expect(commandHelpText).toContain("spinedigest create <archive.sdpub>");
    expect(commandHelpText).toContain("spinedigest export <archive.sdpub>");
    expect(commandHelpText).toContain("spinedigest transform");
    expect(commandHelpText).not.toContain("spinedigest ls");
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
      "~/.wikigraph/config.json",
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
    ).toContain("The chapter must be `graph`");
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
    expect(() =>
      parseCLIArguments([
        "create",
        "book.sdpub",
        "book.md",
        "--input-format",
        "pdf",
      ]),
    ).toThrow("See: spinedigest help format");
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "See: spinedigest help command",
    );
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "See: spinedigest help command",
    );
  });
});
