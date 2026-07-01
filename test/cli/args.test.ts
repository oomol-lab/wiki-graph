import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../src/cli/args.js";
import {
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpMatrixText,
  renderHelpTopicText,
  renderLegacyCommandHelpText,
  renderMainHelpText,
  renderQueueCommandHelpText,
  renderStatusHelpText,
  renderTransformHelpText,
} from "../../src/cli/help.js";

describe("cli/args", () => {
  const archivePath = resolve("book.wikg");

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
    expect(createHelp.helpText).toContain(
      "Command: wikigraph <archive-uri> create",
    );
    expect(createHelp.helpText).toContain("stdin: supported");
  });

  it("parses legacy migration commands", () => {
    expect(parseCLIArguments(["legacy", "--help"])).toStrictEqual({
      help: true,
      helpText: renderLegacyCommandHelpText(),
      kind: "help",
    });
    expect(parseCLIArguments(["legacy", "migrate", "--help"])).toStrictEqual({
      help: true,
      helpText: renderLegacyCommandHelpText("migrate"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["legacy", "migrate", "book.sdpub"]),
    ).toStrictEqual({
      args: {
        action: "migrate",
        inputPath: "book.sdpub",
      },
      help: false,
      kind: "legacy",
    });
    expect(
      parseCLIArguments([
        "legacy",
        "migrate",
        "book.sdpub",
        "--output",
        "book.wikg",
      ]),
    ).toStrictEqual({
      args: {
        action: "migrate",
        inputPath: "book.sdpub",
        outputPath: "book.wikg",
      },
      help: false,
      kind: "legacy",
    });
    expect(() => parseCLIArguments(["book.sdpub"])).toThrow(
      "Legacy .sdpub archives must be migrated first.\nSee: wikigraph legacy migrate --help",
    );
    expect(() => parseCLIArguments(["search", "book.sdpub", "query"])).toThrow(
      "Legacy .sdpub archives must be migrated first.\nSee: wikigraph legacy migrate --help",
    );
  });

  it("renders archive-first stdin create recipes", () => {
    const recipeHelp = parseCLIArguments(["help", "recipe"]);

    expect(recipeHelp.help).toBe(true);
    expect(recipeHelp.kind).toBe("help");
    if (!recipeHelp.help || recipeHelp.kind !== "help") {
      throw new Error("Expected recipe help");
    }
    expect(recipeHelp.helpText).toContain(
      "cat article.md | wikigraph wkg://article.wikg create --input-format markdown",
    );
    expect(recipeHelp.helpText).toContain(
      "cat chapter.txt | wikigraph transform --input-format txt --output-format markdown",
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
        "wkg://book.wikg/chapter/12",
        "queue",
        "add",
        "--task",
        "reading-summary",
        "--boost",
        "--accept-cost",
        "--llm",
        '{"model":"cli-model"}',
      ]),
    ).toStrictEqual({
      args: {
        acceptCost: true,
        action: "add",
        archivePath: archivePath,
        boost: true,
        chapterId: 12,
        llmJSON: '{"model":"cli-model"}',
        target: "reading-summary",
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12",
        "queue",
        "add",
        "--task",
        "reading-summary",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath: archivePath,
        chapterId: 12,
        target: "reading-summary",
      },
      help: false,
      kind: "queue",
    });
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "status", "--accept-cost"]),
    ).toThrow("only valid for `wikigraph queue add`");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chapter/12",
        "queue",
        "add",
        "--stage",
        "graph",
      ]),
    ).toThrow("`wikigraph queue add` does not support --stage.");
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12",
        "queue",
        "add",
        "--task",
        "knowledge-graph",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath: archivePath,
        chapterId: 12,
        target: "knowledge-graph",
      },
      help: false,
      kind: "queue",
    });

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
      parseCLIArguments(["wkg-job://", "list", "--input", "wkg://book.wikg"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath,
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments(["wkg-job://job-1", "get", "--json"]),
    ).toStrictEqual({
      args: {
        action: "status",
        jobId: "job-1",
        json: true,
      },
      help: false,
      kind: "queue",
    });
    expect(
      parseCLIArguments([
        "wkg-job://job-1",
        "watch",
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
    expect(parseCLIArguments(["wkg-job://", "list", "--json"])).toStrictEqual({
      args: {
        action: "list",
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
        "book.wikg",
        "--stage",
        "source",
      ]),
    ).toStrictEqual({
      args: {
        help: false,
        inputPath: "book.epub",
        outputPath: "book.wikg",
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
        "wkg://book.wikg",
        "create",
        "book.md",
        "--input-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
        inputFormat: "markdown",
        sourcePath: "book.md",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg",
        "create",
        "--input-format",
        "markdown",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
        inputFormat: "markdown",
      },
      help: false,
      kind: "archive",
    });
    expect(parseCLIArguments(["wkg://book.wikg", "create"])).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
      },
      help: false,
      kind: "archive",
    });

    expect(() => parseCLIArguments(["build", "book.wikg"])).toThrow(
      "Unknown command: build.",
    );

    expect(
      parseCLIArguments(["wkg://book.wikg/chunk", "search", "RAG", "--json"]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: "wkg://book.wikg/chunk",
        format: "json",
        kinds: ["chunk"],
        query: "RAG",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/11/source",
        "search",
        "exact phrase",
        "--all",
        "--limit",
        "10",
        "--cursor",
        "cursor-token",
        "--context",
        "2",
        "--jsonl",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        all: true,
        archivePath: `wkg://${archivePath}/chapter/11`,
        cursor: "cursor-token",
        context: 2,
        format: "jsonl",
        kinds: ["source"],
        limit: 10,
        query: "exact phrase",
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["wkg://book.wikg/entity", "list"])).toStrictEqual(
      {
        args: {
          action: "list",
          archivePath: "wkg://book.wikg/entity",
          format: "text",
          kinds: ["entity"],
        },
        help: false,
        kind: "archive",
      },
    );

    expect(
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "evidence",
        "--all",
        "--limit",
        "2",
        "--context",
        "0",
        "--jsonl",
      ]),
    ).toStrictEqual({
      args: {
        action: "evidence",
        all: true,
        archivePath: "wkg://book.wikg/entity/Q1",
        context: 0,
        format: "jsonl",
        limit: 2,
        objectId: "wkg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "related",
        "--all",
        "--limit",
        "2",
        "--cursor",
        "4",
        "--context",
        "1",
        "--jsonl",
      ]),
    ).toStrictEqual({
      args: {
        action: "related",
        all: true,
        archivePath: "wkg://book.wikg/entity/Q1",
        context: 1,
        cursor: "4",
        format: "jsonl",
        limit: 2,
        objectId: "wkg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["wkg://book.wikg/triple/Q1/_/Q2", "list"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wkg://book.wikg/triple/Q1/_/Q2",
        format: "text",
        kinds: ["triple"],
        triplePattern: {
          objectQid: "Q2",
          subjectQid: "Q1",
        },
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["wkg://book.wikg/triple/Q1", "list"]),
    ).toMatchObject({
      args: {
        action: "list",
        kinds: ["triple"],
        triplePattern: {
          subjectQid: "Q1",
        },
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12/triple/_/_/Q2",
        "search",
        "agent",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: `wkg://${archivePath}/chapter/12`,
        format: "text",
        kinds: ["triple"],
        query: "agent",
        triplePattern: {
          objectQid: "Q2",
        },
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg:///Users/me/book.wikg",
        "search",
        "RAG",
        "--limit",
        "3",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: "wkg:///Users/me/book.wikg",
        format: "json",
        limit: 3,
        query: "RAG",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg:///Users/me/book.wikg",
        "list",
        "--limit",
        "10",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wkg:///Users/me/book.wikg",
        format: "json",
        limit: 10,
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["wkg://book.wikg/chunk/1", "get"])).toStrictEqual(
      {
        args: {
          action: "get",
          archivePath: "wkg://book.wikg/chunk/1",
          format: "text",
          objectId: "wkg://book.wikg/chunk/1",
        },
        help: false,
        kind: "archive",
      },
    );
    expect(parseCLIArguments(["wkg://book.wikg/chunk/1"])).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/chunk/1",
        format: "text",
        objectId: "wkg://book.wikg/chunk/1",
      },
      help: false,
      kind: "archive",
    });
    expect(parseCLIArguments(["wkg://book.wikg/entity/Q1"])).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/entity/Q1",
        format: "text",
        objectId: "wkg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["wkg://book.wikg/chunk/1", "related"]),
    ).toStrictEqual({
      args: {
        action: "related",
        archivePath: "wkg://book.wikg/chunk/1",
        format: "text",
        objectId: "wkg://book.wikg/chunk/1",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "related",
        "agents",
        "--role",
        "subject",
        "--evidence",
      ]),
    ).toStrictEqual({
      args: {
        action: "related",
        archivePath: "wkg://book.wikg/entity/Q1",
        evidenceLimit: 3,
        format: "text",
        objectId: "wkg://book.wikg/entity/Q1",
        query: "agents",
        role: "subject",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/triple/Q1/mentions/Q2",
        "evidence",
        "agents",
        "--jsonl",
      ]),
    ).toStrictEqual({
      args: {
        action: "evidence",
        archivePath: "wkg://book.wikg/triple/Q1/mentions/Q2",
        format: "jsonl",
        objectId: "wkg://book.wikg/triple/Q1/mentions/Q2",
        query: "agents",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wkg://book.wikg/chunk/1",
        "pack",
        "--budget",
        "2000",
      ]),
    ).toStrictEqual({
      args: {
        action: "pack",
        archivePath: "wkg://book.wikg/chunk/1",
        budget: 2000,
        format: "text",
        objectId: "wkg://book.wikg/chunk/1",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["next", "c_next", "--limit", "7", "--json"]),
    ).toStrictEqual({
      args: {
        action: "next",
        archivePath: "c_next",
        format: "json",
        limit: 7,
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["next", "wkg://book.wikg", "c_next", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "next",
        archivePath: "wkg://book.wikg",
        cursor: "c_next",
        format: "jsonl",
      },
      help: false,
      kind: "archive",
    });

    expect(() => parseCLIArguments(["find", "book.wikg", "RAG"])).toThrow(
      "Unknown command: find.",
    );
    expect(() =>
      parseCLIArguments(["search", "wkg://book.wikg", "RAG"]),
    ).toThrow("Unknown command: search.");
    expect(() => parseCLIArguments(["wkg://book.wikg", "search"])).toThrow(
      "`wikigraph search` requires a search query.",
    );
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "search",
        "RAG",
        "--order",
        "doc-desc",
      ]),
    ).toThrow("Unknown option '--order'.");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "create",
        "source.md",
        "--evidence",
      ]),
    ).toThrow("The `create` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "export", "--evidence"]),
    ).toThrow("The `export` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "create", "--backlinks"]),
    ).toThrow("The `create` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "create", "--role", "subject"]),
    ).toThrow("The `create` command does not support --role.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "export", "--backlinks"]),
    ).toThrow("The `export` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "export", "--role", "subject"]),
    ).toThrow("The `export` command does not support --role.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "estimate", "--evidence"]),
    ).toThrow("The `estimate` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "index", "--evidence"]),
    ).toThrow("The URI-first form does not support `index`.");
    expect(() => parseCLIArguments(["wkg://book.wikg", "status"])).toThrow(
      "The URI-first form does not support `status`.",
    );
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "search",
        "RAG",
        "--type",
        "chunk",
      ]),
    ).toThrow("Unknown option '--type'.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chapter/1/summary", "pack"]),
    ).toThrow("The chapter summary resource does not support `pack`.");
    expect(() => parseCLIArguments(["wkg://book.wikg/entity"])).toThrow(
      "The entity collection does not support `get`. Expected list or search.",
    );
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "related",
        "--role",
        "left",
      ]),
    ).toThrow("--role must be one of: any, subject, object, self.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "search", "RAG", "--role", "any"]),
    ).toThrow("The `search` command does not support --role.");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chunk/1",
        "related",
        "--role",
        "subject",
      ]),
    ).toThrow("The `related` command does not support --role.");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "related",
        "--backlinks",
      ]),
    ).toThrow("The `related` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "evidence",
        "--backlinks",
      ]),
    ).toThrow("The `evidence` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/entity/Q1", "pack", "--backlinks"]),
    ).toThrow("The `pack` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg", "create", "--context", "2"]),
    ).toThrow("The `create` command does not support --context.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chunk/1", "pack", "--context", "2"]),
    ).toThrow("The `pack` command does not support --context.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/triple/Q1/mentions/Q2", "related"]),
    ).toThrow("Related is only available for chunk and entity objects");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/triple/Q1/mentions/Q2", "pack"]),
    ).toThrow("Supported pack targets are chunk and entity objects.");
  });

  it("keeps explicit negative evidence values for validation", () => {
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "search",
        "RAG",
        "--evidence",
        "-1",
      ]),
    ).toThrow("--evidence must be a non-negative integer.");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "search",
        "RAG",
        "--context",
        "-1",
      ]),
    ).toThrow("--context must be a non-negative integer.");
    expect(
      parseCLIArguments([
        "wkg://book.wikg/entity/Q1",
        "get",
        "--evidence",
        "0",
      ]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/entity/Q1",
        evidenceLimit: 0,
        format: "text",
        objectId: "wkg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });
  });

  it("parses archive metadata and cover commands", () => {
    expect(
      parseCLIArguments(["wkg://book.wikg/", "get", "--json"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/",
        format: "json",
        objectId: "wkg://book.wikg/",
      },
      help: false,
      kind: "archive",
    });
    expect(parseCLIArguments(["wkg://book.wikg/"])).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/",
        format: "text",
        objectId: "wkg://book.wikg/",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/",
        "set",
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
        inputPath: archivePath,
        metaPatch: {
          authors: ["Ari Lantern", "Bea North"],
          clearDescription: true,
          title: "Updated Book",
        },
      },
      help: false,
      kind: "meta",
    });
    expect(parseCLIArguments(["wkg://book.wikg/cover", "get"])).toStrictEqual({
      args: {
        inputPath: archivePath,
      },
      help: false,
      kind: "cover",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/", "set", "--help"]),
    ).toMatchObject({
      help: true,
      kind: "maintenance",
    });
  });

  it("parses archive chapter edit actions", () => {
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12/source",
        "set",
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
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter",
        "add",
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
        path: archivePath,
        title: "Chapter 1",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
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
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
        "--parent",
        "wkg://chapter/3",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterId: 8,
        parentChapterId: 3,
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
        "--before",
        "wkg://book.wikg/chapter/9",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        beforeChapterId: 9,
        chapterId: 8,
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
        "--parent",
        "wkg://other.wikg/chapter/3",
      ]),
    ).toThrow("Chapter URI belongs to a different archive.");
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
        "--root",
        "--last",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterId: 8,
        last: true,
        moveToRoot: true,
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12",
        "reset",
        "--to",
        "source",
      ]),
    ).toStrictEqual({
      args: {
        action: "reset",
        chapterId: 12,
        path: archivePath,
        resetStage: "sourced",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/12/title", "set", "--clear"]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterId: 12,
        clearTitle: true,
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/tree", "get", "--json"]),
    ).toStrictEqual({
      args: {
        action: "tree",
        json: true,
        path: archivePath,
        treeAction: "show",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter", "list", "--help"]),
    ).toMatchObject({
      help: true,
      kind: "help",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter", "list", "--json"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wkg://book.wikg/chapter",
        format: "json",
        kinds: ["chapter"],
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/12/state", "get"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/chapter/12/state",
        format: "text",
        objectId: "wkg://book.wikg/chapter/12/state",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12/state/reading-graph",
        "get",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wkg://book.wikg/chapter/12/state/reading-graph",
        format: "json",
        objectId: "wkg://book.wikg/chapter/12/state/reading-graph",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/12/entity", "list"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: `wkg://${archivePath}/chapter/12`,
        format: "text",
        kinds: ["entity"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chapter/12", "status"]),
    ).toThrow("The URI-first form does not support `status`.");
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/12/title", "set", "--help"]),
    ).toMatchObject({
      help: true,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/tree",
        "set",
        "--input",
        "tree.json",
        "--dry-run",
      ]),
    ).toStrictEqual({
      args: {
        action: "tree",
        dryRun: true,
        inputPath: "tree.json",
        path: archivePath,
        treeAction: "apply",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments(["wkg://book.wikg/chapter/tree", "set", "--dry-run"]),
    ).toStrictEqual({
      args: {
        action: "tree",
        dryRun: true,
        path: archivePath,
        treeAction: "apply",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wkg://book.wikg/chapter/12/title",
        "set",
        "--title",
        "Renamed Chapter",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterId: 12,
        path: archivePath,
        title: "Renamed Chapter",
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chapter/8",
        "move",
        "--parent",
        "3",
        "--root",
      ]),
    ).toThrow("Choose only one parent target");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chapter/12/title",
        "set",
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

    expect(parseCLIArguments(["search", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveCommandHelpText("search"),
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
    expect(parseCLIArguments(["help", "object"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "object" }),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "object", "entity"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "object", object: "entity" }),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "entity"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "object", object: "entity" }),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "verb", "get"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "verb", verb: "get" }),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "get"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "verb", verb: "get" }),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "matrix"])).toStrictEqual({
      help: true,
      helpText: renderHelpMatrixText({ kind: "matrix" }),
      kind: "help",
    });
  });

  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unknown command: book.epub.\nSee: wikigraph help command",
    );
    expect(() => parseCLIArguments(["book.wikg", "search", "RAG"])).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: book.wikg\nUse: wkg://book.wikg\nSee: wikigraph help uri",
    );
    expect(() =>
      parseCLIArguments(["/Users/me/book.wikg/chapter/12", "get"]),
    ).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: /Users/me/book.wikg/chapter/12\nUse: wkg:///Users/me/book.wikg/chapter/12\nSee: wikigraph help uri",
    );
    expect(() =>
      parseCLIArguments(["C:\\books\\book.wikg\\chapter\\12", "get"]),
    ).toThrow(
      "Expected a Wiki Graph URI, not a filesystem path: C:\\books\\book.wikg\\chapter\\12\nUse: wkg://C:/books/book.wikg/chapter/12\nSee: wikigraph help uri",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "create",
        "book.md",
        "--input-format",
        "pdf",
      ]),
    ).toThrow(
      "Invalid --input-format: pdf. Expected one of wikg, epub, txt, markdown.\nSee: wikigraph help format",
    );
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "export",
        "--output-format",
        "pdf",
      ]),
    ).toThrow(
      "Invalid --output-format: pdf. Expected one of wikg, epub, txt, markdown.\nSee: wikigraph help format",
    );
  });

  it("rejects removed command families and invalid maintenance usage", () => {
    expect(() => parseCLIArguments([])).toThrow(
      "Missing command.\nSee: wikigraph help command",
    );
    expect(() => parseCLIArguments(["import", "--help"])).toThrow(
      "Unknown command: import.\nSee: wikigraph help command",
    );
    expect(() => parseCLIArguments(["ls", "book.wikg"])).toThrow(
      "Unknown command: ls.\nSee: wikigraph help command",
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
        "wkg://book.wikg/",
        "set",
        "--json",
        "--title",
        "Updated",
      ]),
    ).toThrow("The `meta` command does not support --json.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/cover", "get", "--json"]),
    ).toThrow("The `cover` command does not support --json.");
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chapter/x/source", "set"]),
    ).toThrow(
      "Use `wikigraph help object` to inspect valid object/verb pairs.",
    );
    expect(() => parseCLIArguments(["wkg://entity/Q9957", "get"])).toThrow(
      "Short object URIs from output are archive-relative handles.",
    );
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chapter/1/source", "set"]),
    ).toThrow(
      "Missing --input-format. `chapter set-source` requires txt or markdown.\nSee: wikigraph wkg://book.wikg/chapter/1/source set --help",
    );
    expect(() =>
      parseCLIArguments(["wkg://book.wikg/chapter/1/source", "set", "--jsonl"]),
    ).toThrow(
      "The `chapter` command does not support --jsonl.\nSee: wikigraph wkg://book.wikg/chapter/1/source set --help",
    );
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg/chapter/1",
        "reset",
        "--to",
        "summarized",
      ]),
    ).toThrow(
      "Invalid --to: summarized. Expected planned, source, or reading-graph.\nSee: wikigraph wkg://book.wikg/chapter/1 reset --help",
    );
  });

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of overview, task, command, object, verb, matrix, format, config, env, config-file, runtime, uri, retrieval, recipe, troubleshoot, ai.\nSee: wikigraph --help",
    );
    expect(() =>
      parseCLIArguments(["help", "object", "entity", "extra"]),
    ).toThrow("Unexpected positional arguments: extra.");
    expect(() => parseCLIArguments(["help", "verb", "get", "extra"])).toThrow(
      "Unexpected positional arguments: extra.",
    );
    expect(() =>
      parseCLIArguments(["help", "task", "--input", "book.epub"]),
    ).toThrow(
      "The `help` command does not support --input.\nSee: wikigraph --help",
    );
    expect(() =>
      parseCLIArguments(["help", "overview", "--llm", '{"model":"cli-model"}']),
    ).toThrow(
      "The `help` command does not support --llm.\nSee: wikigraph --help",
    );
  });

  it("rejects invalid config status usage", () => {
    expect(() =>
      parseCLIArguments(["config", "status", "--input", "book.epub"]),
    ).toThrow(
      "The `config status` command does not support --input.\nSee: wikigraph config status --help",
    );
    expect(() => parseCLIArguments(["status", "book.wikg"])).toThrow(
      "Unknown command: status.",
    );
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const commandHelpText = renderHelpTopicText("command");

    expect(rootHelpText).toContain("wikigraph help [topic]");
    expect(rootHelpText).toContain("wikigraph <located-wkg-uri> search");
    expect(rootHelpText).toContain(
      "wikigraph <located-wkg-uri>/<chapter|entity|triple|source|summary|chunk> list",
    );
    expect(rootHelpText).toContain("wikigraph help overview");
    expect(rootHelpText).toContain("wikigraph help uri");
    expect(rootHelpText).toContain("wikigraph help env");
    expect(rootHelpText).toContain("wikigraph help config-file");
    expect(rootHelpText).toContain("wikigraph <archive-uri> get");
    expect(rootHelpText).toContain(
      "wikigraph <archive-uri>/chapter/tree get|set",
    );
    expect(rootHelpText).toContain("wikigraph transform");
    expect(rootHelpText).not.toContain("wikigraph import");
    expect(rootHelpText).toContain("wikigraph <chapter-uri> queue add");
    expect(rootHelpText).toContain(
      "Append `--help` to commands and subcommands",
    );
    expect(rootHelpText).toContain("Treat `wikigraph --help` as the root");
    expect(rootHelpText).toContain(
      "Read `wikigraph help overview` for the URI-first archive mental model.",
    );
    expect(rootHelpText).toContain("wikigraph help retrieval");
    expect(rootHelpText).toContain("wikigraph help object");
    expect(rootHelpText).toContain("wikigraph help verb");
    expect(rootHelpText).toContain("wikigraph help matrix");
    expect(rootHelpText).toContain("Queue generation tasks call an LLM");
    expect(renderHelpTopicText("runtime")).toContain("Runtime Behavior");
    expect(renderHelpTopicText("config")).toContain("Configuration Overview");
    expect(renderHelpTopicText("command")).toContain(
      "wikigraph <located-wkg-uri> search",
    );
    expect(renderHelpTopicText("command")).toContain(
      "wikigraph <entity|triple|summary|chunk-uri> evidence",
    );
    expect(renderHelpTopicText("ai")).toContain("Primary contract:");
    expect(renderHelpTopicText("ai")).toContain(
      "Use Wiki Graph URIs as stable object handles",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "Never pass a bare filesystem path to URI-targeted commands.",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "/Users/me/book.wikg -> wkg:///Users/me/book.wikg",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "wikigraph wkg:///Users/me/book.wikg/entity search",
    );
    expect(renderHelpTopicText("ai")).toContain(
      "wkg:///absolute/path/book.wikg/entity/Q8018",
    );
    expect(renderHelpTopicText("uri")).toContain(
      "Do not pass a bare filesystem path as a command target.",
    );
    expect(renderHelpTopicText("uri")).toContain(
      "wikigraph wkg:///Users/me/book.wikg/entity search",
    );
    expect(renderHelpTopicText("uri")).toContain(
      String.raw`C:\Users\me\book.wikg -> wkg://C:/Users/me/book.wikg`,
    );
    expect(renderHelpTopicText("retrieval")).toContain("Retrieval Strategy");
    expect(renderHelpTopicText("retrieval")).toContain(
      "Choose the right Wiki Graph scope, lens, pagination, and output format",
    );
    expect(renderHelpTopicText("task")).toContain(
      "wikigraph wkg:///Users/me/book.wikg search",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wikigraph wkg:///Users/me/book.wikg search",
    );
    expect(commandHelpText).toContain("Object commands:");
    expect(commandHelpText).toContain("wikigraph <archive-uri> create");
    expect(commandHelpText).toContain("wikigraph <archive-uri> export");
    expect(commandHelpText).toContain("wikigraph transform");
    expect(commandHelpText).not.toContain("wikigraph ls");
    expect(renderHelpTopicText("config")).toContain("wikigraph help env");
    expect(renderHelpTopicText("config")).toContain("Inline LLM JSON");
    expect(renderHelpTopicText("config")).toContain("baseUrl");
    expect(renderHelpTopicText("env")).toContain("WIKIGRAPH_LLM_MODEL");
    expect(renderHelpTopicText("env")).toContain("WIKIGRAPH_REQUEST_STREAM");
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
    ).toContain("The chapter must be `reading-graph`");
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

    expect(rootHelpText).toContain("wikigraph help overview");
    expect(rootHelpText).toContain("wikigraph help command");
    expect(() =>
      parseCLIArguments([
        "wkg://book.wikg",
        "create",
        "book.md",
        "--input-format",
        "pdf",
      ]),
    ).toThrow("See: wikigraph help format");
    expect(() => parseCLIArguments(["wikg", "inspect"])).toThrow(
      "See: wikigraph help command",
    );
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "See: wikigraph help command",
    );
  });
});
