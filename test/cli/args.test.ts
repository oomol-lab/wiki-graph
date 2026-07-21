import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { parseCLIArguments } from "../../packages/cli/src/args/index.js";
import {
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderGcCommandHelpText,
  renderHelpTopicText,
  renderLegacyCommandHelpText,
  renderMainHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
  renderTransformHelpText,
} from "../../packages/cli/src/args/help.js";

describe("cli/args", () => {
  const archivePath = resolve("book.wikg");
  const wikispineRuntimeGuideUrl =
    "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md";

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

  it("renders URI predicate help", () => {
    const createHelp = parseCLIArguments([
      "wikg://book.wikg",
      "create",
      "--help",
    ]);
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
    expect(createHelp.helpText).toContain("Command: wg <uri> create");
    expect(createHelp.helpText).toContain("Create the archive");
    expect(createHelp.helpText).toContain(
      "Existing archives are not overwritten by default",
    );
    expect(() => parseCLIArguments(["create", "--help"])).toThrow(
      "Unknown command: create.",
    );
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/unknown", "--help"]),
    ).toThrow(
      "Unknown Wiki Graph URI target: wikg://book.wikg/unknown. Use the archive root help or URI guide to choose a valid target.",
    );
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
      "Unknown command: book.sdpub.",
    );
    expect(() => parseCLIArguments(["search", "book.sdpub", "query"])).toThrow(
      "Unknown command: search.",
    );
  });

  it("renders archive-first create recipes", () => {
    const recipeHelp = parseCLIArguments(["help", "recipe"]);

    expect(recipeHelp.help).toBe(true);
    expect(recipeHelp.kind).toBe("help");
    if (!recipeHelp.help || recipeHelp.kind !== "help") {
      throw new Error("Expected recipe help");
    }
    expect(recipeHelp.helpText).toContain(
      "wg wikg://book.wikg create --import ./book.epub",
    );
    expect(recipeHelp.helpText).toContain(
      "cat chapter.txt | wg transform --input-format txt --output-format markdown",
    );
  });

  it("parses local config URI commands", () => {
    expect(parseCLIArguments(["wikg://local/config/llm"])).toStrictEqual({
      args: {
        action: "get",
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/llm",
        "put",
        "provider",
        "openai-compatible",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        inputValue: "openai-compatible",
        key: "provider",
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/llm",
        "put",
        "apiKey",
        "--secret",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        key: "apiKey",
        secret: true,
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/concurrent",
        "set",
        "--json",
        '{"job":2,"request":4}',
      ]),
    ).toStrictEqual({
      args: {
        action: "set",
        json: true,
        jsonInputValue: '{"job":2,"request":4}',
        section: "concurrent",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/wikispine",
        "put",
        "provider",
        "fetch",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        inputValue: "fetch",
        key: "provider",
        section: "wikispine",
      },
      help: false,
      kind: "local-config",
    });
    expect(() => parseCLIArguments(["wikg://local/config"])).toThrow(
      "Expected a local config section URI",
    );
    expect(() => parseCLIArguments(["wikg://local/config/llm", "get"])).toThrow(
      "This command form is not available.",
    );
  });

  it("parses gc commands", () => {
    expect(parseCLIArguments(["gc"])).toStrictEqual({
      args: {},
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--json"])).toStrictEqual({
      args: {
        json: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--force", "--json"])).toStrictEqual({
      args: {
        force: true,
        json: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--force", "--dry-run"])).toStrictEqual({
      args: {
        dryRun: true,
        force: true,
      },
      help: false,
      kind: "gc",
    });
    expect(parseCLIArguments(["gc", "--help"])).toStrictEqual({
      help: true,
      helpText: renderGcCommandHelpText(),
      kind: "help",
    });
    expect(() => parseCLIArguments(["transform", "--force"])).toThrow(
      "The --force option is only supported by `gc`.",
    );
    expect(() => parseCLIArguments(["gc", "--jsonl"])).toThrow(
      "The `gc` command does not support --jsonl",
    );
  });

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

  it("parses queue commands", () => {
    expect(
      parseCLIArguments([
        "wikg://local/job",
        "add",
        "--input",
        "wikg://book.wikg/chapter/12",
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
        inputPath: "wikg://book.wikg/chapter/12",
        llmJSON: '{"model":"cli-model"}',
        target: "reading-summary",
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments([
        "wikg://local/job",
        "add",
        "--input",
        "wikg://book.wikg/chapter/12",
        "--task",
        "reading-summary",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath: archivePath,
        chapterId: 12,
        inputPath: "wikg://book.wikg/chapter/12",
        target: "reading-summary",
      },
      help: false,
      kind: "queue",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "status", "--accept-cost"]),
    ).toThrow("only valid for `wg wikg://local/job add`");
    expect(() =>
      parseCLIArguments([
        "wikg://local/job",
        "add",
        "--input",
        "wikg://book.wikg/chapter/12",
        "--stage",
        "graph",
      ]),
    ).toThrow("`wg wikg://local/job add` does not support --stage.");
    expect(
      parseCLIArguments([
        "wikg://local/job",
        "add",
        "--input",
        "wikg://book.wikg/chapter/12",
        "--task",
        "knowledge-graph",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath: archivePath,
        chapterId: 12,
        inputPath: "wikg://book.wikg/chapter/12",
        target: "knowledge-graph",
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments([
        "wikg://local/job",
        "add",
        "--input",
        "wikg://book.wikg",
        "--task",
        "knowledge-graph",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        archivePath,
        inputPath: "wikg://book.wikg",
        json: true,
        target: "knowledge-graph",
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments(["wikg://local/job", "--input", "wikg://book.wikg"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath,
      },
      help: false,
      kind: "queue",
    });

    expect(
      parseCLIArguments(["wikg://local/job/job-1", "--json"]),
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
        "wikg://local/job/job-1",
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
    expect(parseCLIArguments(["wikg://local/job", "--json"])).toStrictEqual({
      args: {
        action: "list",
        json: true,
      },
      help: false,
      kind: "queue",
    });
    expect(
      parseCLIArguments([
        "wikg://local/job/job-1/target",
        "set",
        "reading-summary",
      ]),
    ).toStrictEqual({
      args: {
        action: "target",
        jobId: "job-1",
        target: "reading-summary",
      },
      help: false,
      kind: "queue",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://local/job/job-1",
        "set",
        "--task",
        "reading-summary",
      ]),
    ).toThrow("is not supported");

    expect(() => parseCLIArguments(["queue", "--help"])).toThrow(
      "Unknown command: queue.",
    );

    expect(parseCLIArguments(["wikg://local/job", "--help"])).toStrictEqual({
      help: true,
      helpText: renderUriHelpText("job-collection-scope", "wikg://local/job"),
      kind: "help",
    });
    expect(() => parseCLIArguments(["wikg://local/job", "list"])).toThrow(
      "This command form is not available.",
    );
    expect(() => parseCLIArguments(["wikg://local/job/job-1", "get"])).toThrow(
      "This command form is not available.",
    );

    expect(() =>
      parseCLIArguments(["wikg://local/job/job-1", "watch", "--json"]),
    ).toThrow(
      "The `watch` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.",
    );
    expect(() => parseCLIArguments(["wikg://local/job", "--jsonl"])).toThrow(
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
        "wikg://book.wikg",
        "create",
        "--import",
        "book.epub",
        "--replace",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
        importPath: "book.epub",
        replace: true,
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["wikg://book.wikg", "create"])).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "book.epub"]),
    ).toThrow("Unexpected positional arguments for `create`: book.epub.");
    expect(
      parseCLIArguments(["wikg://book.wikg", "create", "--json"]),
    ).toStrictEqual({
      args: {
        action: "create",
        archivePath: archivePath,
        json: true,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--jsonl"]),
    ).toThrow("The `create` command does not support --jsonl.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--replace"]),
    ).toThrow(
      "The --replace option is only supported by `wg <archive-uri> create`.",
    );

    expect(() => parseCLIArguments(["build", "book.wikg"])).toThrow(
      "Unknown command: build.",
    );

    expect(
      parseCLIArguments(["wikg://book.wikg/chunk", "--query", "RAG", "--json"]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: "wikg://book.wikg/chunk",
        format: "json",
        kinds: ["chunk"],
        query: "RAG",
      },
      help: false,
      kind: "archive",
    });

    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/11/source",
        "--query",
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
    ).toThrow("`--query` requires a scope URI");

    expect(parseCLIArguments(["wikg://book.wikg/entity"])).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/entity",
        format: "text",
        kinds: ["entity"],
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "evidence",
        "--reverse",
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
        archivePath: "wikg://book.wikg/entity/Q1",
        context: 0,
        format: "jsonl",
        limit: 2,
        objectId: "wikg://book.wikg/entity/Q1",
        reverse: true,
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "related",
        "--reverse",
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
        archivePath: "wikg://book.wikg/entity/Q1",
        context: 1,
        cursor: "4",
        format: "jsonl",
        limit: 2,
        objectId: "wikg://book.wikg/entity/Q1",
        reverse: true,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "related",
        "--query",
        "agent",
        "--reverse",
      ]),
    ).toThrow("`--reverse` cannot be combined with --query.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "--query", "agent", "--reverse"]),
    ).toThrow(
      "`--reverse` cannot be combined with --query.\nSee: wg wikg://book.wikg --help",
    );

    expect(
      parseCLIArguments(["wikg://book.wikg/triple/Q1/_/Q2"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/triple/Q1/_/Q2",
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

    expect(parseCLIArguments(["wikg://book.wikg/triple/Q1"])).toMatchObject({
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
        "wikg://book.wikg/chapter/12/triple/_/_/Q2",
        "--query",
        "agent",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: `wikg://${archivePath}/chapter/12`,
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
        "wikg:///Users/me/book.wikg",
        "--query",
        "RAG",
        "--limit",
        "3",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: "wikg:///Users/me/book.wikg",
        format: "json",
        limit: 3,
        query: "RAG",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wikg:///Users/me/book.wikg",
        "--limit",
        "10",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg:///Users/me/book.wikg",
        format: "json",
        limit: 10,
      },
      help: false,
      kind: "archive",
    });

    expect(parseCLIArguments(["wikg://book.wikg/chunk/1"])).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/chunk/1",
        format: "text",
        objectId: "wikg://book.wikg/chunk/1",
      },
      help: false,
      kind: "archive",
    });
    expect(parseCLIArguments(["wikg://book.wikg/entity/Q1"])).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/entity/Q1",
        format: "text",
        objectId: "wikg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments(["wikg://book.wikg/chunk/1", "related"]),
    ).toStrictEqual({
      args: {
        action: "related",
        archivePath: "wikg://book.wikg/chunk/1",
        format: "text",
        objectId: "wikg://book.wikg/chunk/1",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "related",
        "--query",
        "agents",
        "--role",
        "subject",
        "--evidence",
      ]),
    ).toStrictEqual({
      args: {
        action: "related",
        archivePath: "wikg://book.wikg/entity/Q1",
        evidenceLimit: 3,
        format: "text",
        objectId: "wikg://book.wikg/entity/Q1",
        query: "agents",
        role: "subject",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wikg://book.wikg/triple/Q1/mentions/Q2",
        "evidence",
        "--query",
        "agents",
        "--jsonl",
      ]),
    ).toStrictEqual({
      args: {
        action: "evidence",
        archivePath: "wikg://book.wikg/triple/Q1/mentions/Q2",
        format: "jsonl",
        objectId: "wikg://book.wikg/triple/Q1/mentions/Q2",
        query: "agents",
      },
      help: false,
      kind: "archive",
    });

    expect(
      parseCLIArguments([
        "wikg://book.wikg/chunk/1",
        "pack",
        "--budget",
        "2000",
      ]),
    ).toStrictEqual({
      args: {
        action: "pack",
        archivePath: "wikg://book.wikg/chunk/1",
        budget: 2000,
        format: "text",
        objectId: "wikg://book.wikg/chunk/1",
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
      parseCLIArguments(["next", "wikg://book.wikg", "c_next", "--jsonl"]),
    ).toStrictEqual({
      args: {
        action: "next",
        archivePath: "wikg://book.wikg",
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
      parseCLIArguments(["search", "wikg://book.wikg", "RAG"]),
    ).toThrow("Unknown command: search.");
    expect(() => parseCLIArguments(["wikg://book.wikg", "search"])).toThrow(
      "This command form is not available.",
    );
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "search",
        "--query",
        "RAG",
        "--order",
        "doc-desc",
      ]),
    ).toThrow("Unknown option '--order'.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--evidence"]),
    ).toThrow("The `create` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "export", "--evidence"]),
    ).toThrow("The `export` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--backlinks"]),
    ).toThrow("The `create` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--role", "subject"]),
    ).toThrow("The `create` command does not support --role.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--query", "agent"]),
    ).toThrow("The `create` command does not support --query.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--reverse"]),
    ).toThrow("The `create` command does not support --reverse.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "export", "--backlinks"]),
    ).toThrow("The `export` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "export", "--role", "subject"]),
    ).toThrow("The `export` command does not support --role.");
    expect(parseCLIArguments(["wikg://book.wikg", "inspect"])).toStrictEqual({
      args: {
        action: "inspect",
        archivePath,
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/2", "inspect"]),
    ).toStrictEqual({
      args: {
        action: "inspect",
        archivePath,
        chapterId: 2,
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg", "inspect", "--json"]),
    ).toStrictEqual({
      args: {
        action: "inspect",
        archivePath,
        json: true,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--jsonl"]),
    ).toThrow("The `inspect` command does not support --jsonl.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--evidence"]),
    ).toThrow("The `inspect` command does not support --evidence.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--query", "agent"]),
    ).toThrow("The `inspect` command does not support --query.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--chapter", "2"]),
    ).toThrow("The `inspect` command does not support --chapter.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--from", "1"]),
    ).toThrow("The `inspect` command does not support --from.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "inspect", "--cursor", "c_1"]),
    ).toThrow("The `inspect` command does not support --cursor.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "index", "--evidence"]),
    ).toThrow("The URI-first form does not support `index`.");
    expect(() => parseCLIArguments(["wikg://book.wikg", "status"])).toThrow(
      "The URI-first form does not support `status`.",
    );
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "search",
        "--query",
        "RAG",
        "--type",
        "chunk",
      ]),
    ).toThrow("Unknown option '--type'.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/1/summary", "pack"]),
    ).toThrow("The chapter summary resource does not support `pack`.");
    expect(parseCLIArguments(["wikg://book.wikg/entity"])).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/entity",
        format: "text",
        kinds: ["entity"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "related",
        "--role",
        "left",
      ]),
    ).toThrow("--role must be one of: any, subject, object, self.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "--query",
        "RAG",
        "--role",
        "any",
      ]),
    ).toThrow("The `search` command does not support --role.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chunk/1",
        "related",
        "--role",
        "subject",
      ]),
    ).toThrow("The `related` command does not support --role.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "related",
        "--backlinks",
      ]),
    ).toThrow("The `related` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/entity/Q1",
        "evidence",
        "--backlinks",
      ]),
    ).toThrow("The `evidence` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/entity/Q1", "pack", "--backlinks"]),
    ).toThrow("The `pack` command does not support --backlinks.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--context", "2"]),
    ).toThrow("The `create` command does not support --context.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chunk/1", "pack", "--context", "2"]),
    ).toThrow("The `pack` command does not support --context.");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/triple/Q1/mentions/Q2", "related"]),
    ).toThrow("Related is only available for chunk and entity objects");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/triple/Q1/mentions/Q2", "pack"]),
    ).toThrow("Supported pack targets are chunk and entity objects.");
  });

  it("routes URI-first commands from explicit scope and object kinds", () => {
    expect(parseCLIArguments(["wikg://book.wikg/chapter/12"])).toStrictEqual({
      args: {
        action: "list",
        archivePath: `wikg://${archivePath}/chapter/12`,
        format: "text",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12", "--query", "agent"]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: `wikg://${archivePath}/chapter/12`,
        format: "text",
        query: "agent",
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/12", "get"]),
    ).toThrow("This command form is not available.");
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/title"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: `wikg://${archivePath}/chapter/12/title`,
        format: "text",
        objectId: `wikg://${archivePath}/chapter/12/title`,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/12/source", "--query", "x"]),
    ).toThrow("`--query` requires a scope URI");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/triple/Q1/mentions",
        "--query",
        "agent",
      ]),
    ).toMatchObject({
      args: {
        action: "search",
        kinds: ["triple"],
        query: "agent",
        triplePattern: {
          predicate: "mentions",
          subjectQid: "Q1",
        },
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/triple/Q1/mentions/Q2"]),
    ).toMatchObject({
      args: {
        action: "get",
        objectId: "wikg://book.wikg/chapter/12/triple/Q1/mentions/Q2",
      },
      help: false,
      kind: "archive",
    });
  });

  it("keeps explicit negative evidence values for validation", () => {
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "--query",
        "RAG",
        "--evidence",
        "-1",
      ]),
    ).toThrow("--evidence must be a non-negative integer.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg",
        "--query",
        "RAG",
        "--context",
        "-1",
      ]),
    ).toThrow("--context must be a non-negative integer.");
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q1", "--evidence", "0"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/entity/Q1",
        evidenceLimit: 0,
        format: "text",
        objectId: "wikg://book.wikg/entity/Q1",
      },
      help: false,
      kind: "archive",
    });
  });

  it("parses archive metadata and cover commands", () => {
    expect(parseCLIArguments(["wikg://book.wikg/"])).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/",
        format: "text",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/meta",
        "set",
        "--json",
        '{"title":"Updated Book","authors":["Ari Lantern","Bea North"]}',
      ]),
    ).toStrictEqual({
      args: {
        action: "set",
        archivePath,
        json: true,
        jsonInputValue:
          '{"title":"Updated Book","authors":["Ari Lantern","Bea North"]}',
        objectPath: "",
      },
      help: false,
      kind: "object-metadata",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/entity/Q42/meta",
        "put",
        "note",
        "x",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        archivePath,
        inputValue: "x",
        key: "note",
        objectPath: "entity/Q42",
      },
      help: false,
      kind: "object-metadata",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q42/meta", "delete", "note"]),
    ).toStrictEqual({
      args: {
        action: "delete",
        archivePath,
        key: "note",
        objectPath: "entity/Q42",
      },
      help: false,
      kind: "object-metadata",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q42/meta", "clear"]),
    ).toStrictEqual({
      args: {
        action: "clear",
        archivePath,
        objectPath: "entity/Q42",
      },
      help: false,
      kind: "object-metadata",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/entity/Q42/meta/note"]),
    ).toThrow("Metadata keys are not addressed in the URI");
    expect(parseCLIArguments(["wikg://book.wikg/cover"])).toStrictEqual({
      args: {
        inputPath: archivePath,
      },
      help: false,
      kind: "cover",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/", "set", "--title", "Old"]),
    ).toThrow("archive URI form does not support `set`");
  });

  it("parses archive chapter edit actions", () => {
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/source",
        "set",
        "--input",
        "chapter.md",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-source",
        chapterId: 12,
        inputPath: "chapter.md",
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/source",
        "set",
        "--input",
        "chapter.txt",
        "--input-format",
        "txt",
      ]),
    ).toThrow(
      "The `chapter set-source` action does not support --input-format.",
    );
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter",
        "add",
        "--title",
        "Chapter 1",
        "--parent",
        "3",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        parentChapterId: 3,
        path: archivePath,
        title: "Chapter 1",
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter",
        "add",
        "--title",
        "Chapter 1",
        "--input",
        "chapter.txt",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        inputPath: "chapter.txt",
        path: archivePath,
        title: "Chapter 1",
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter",
        "add",
        "--stage",
        "planned",
      ]),
    ).toThrow("The `chapter add` action does not support --stage.");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/8",
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
        "wikg://book.wikg/chapter/8",
        "move",
        "--parent",
        "wikg://chapter/3",
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
        "wikg://book.wikg/chapter/8",
        "move",
        "--before",
        "wikg://book.wikg/chapter/9",
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
        "wikg://book.wikg/chapter/8",
        "move",
        "--parent",
        "wikg://other.wikg/chapter/3",
      ]),
    ).toThrow("Chapter URI belongs to a different archive.");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/8",
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
        "wikg://book.wikg/chapter/12",
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
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/title",
        "set",
        "--clear",
      ]),
    ).toThrow("does not support --clear. Use `clear`.");
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/title", "clear"]),
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
      parseCLIArguments(["wikg://book.wikg/chapter/tree", "--json"]),
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
      parseCLIArguments(["wikg://book.wikg/chapter", "--help"]),
    ).toMatchObject({
      help: true,
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter", "--json"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/chapter",
        format: "json",
        kinds: ["chapter"],
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/state"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/chapter/12/state",
        format: "text",
        objectId: "wikg://book.wikg/chapter/12/state",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/state/reading-graph",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/chapter/12/state/reading-graph",
        format: "json",
        objectId: "wikg://book.wikg/chapter/12/state/reading-graph",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/entity"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: `wikg://${archivePath}/chapter/12`,
        format: "text",
        kinds: ["entity"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/12", "status"]),
    ).toThrow("The URI-first form does not support `status`.");
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/title", "set", "--help"]),
    ).toMatchObject({
      help: true,
      kind: "help",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/tree",
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
      parseCLIArguments(["wikg://book.wikg/chapter/tree", "set", "--dry-run"]),
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
        "wikg://book.wikg/chapter/12/title",
        "set",
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
        "wikg://book.wikg/chapter/8",
        "move",
        "--parent",
        "3",
        "--root",
      ]),
    ).toThrow("Choose only one parent target");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/title",
        "set",
        "--title",
        "Title",
        "--clear",
      ]),
    ).toThrow("does not support --clear. Use `clear`.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/summary",
        "set",
        "--import",
        "book.epub",
      ]),
    ).toThrow("The `chapter set-summary` action does not support --import.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/title",
        "set",
        "Title",
        "--import",
        "book.epub",
      ]),
    ).toThrow("The `chapter set-title` action does not support --import.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/tree",
        "set",
        "--import",
        "book.epub",
      ]),
    ).toThrow("The `chapter tree` action does not support --import.");
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
    expect(() =>
      parseCLIArguments(["chapter", "set-summary", "--help"]),
    ).toThrow("Use concrete chapter resource URIs");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/summary",
        "set",
        "--help",
      ]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "chapter-summary-object",
        "set",
        "wikg://book.wikg/chapter/12/summary",
      ),
      kind: "help",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/12/summary",
        "evidence",
        "--help",
      ]),
    ).toThrow("does not support `evidence`");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/12/summary", "evidence"]),
    ).toThrow("wg <chapter-uri>/summary --help");
    expect(() => parseCLIArguments(["chapter", "set-title", "--help"])).toThrow(
      "Use concrete chapter resource URIs",
    );
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/12/title", "set", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "chapter-title-object",
        "set",
        "wikg://book.wikg/chapter/12/title",
      ),
      kind: "help",
    });
  });

  it("prints help topic pages", () => {
    expect(parseCLIArguments(["help", "runtime"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("runtime"),
      kind: "help",
    });
    expect(() => parseCLIArguments(["search", "--help"])).toThrow(
      "Unknown command: search.",
    );
    expect(() => parseCLIArguments(["help", "object"])).toThrow(
      "Invalid help topic: object.",
    );
    expect(() => parseCLIArguments(["help", "object", "entity"])).toThrow(
      "Unexpected positional arguments: entity.",
    );
    expect(() => parseCLIArguments(["help", "entity"])).toThrow(
      "Invalid help topic: entity.",
    );
    expect(
      parseCLIArguments(["wikg://book.wikg/chunk", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText("chunk-scope", "wikg://book.wikg/chunk"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/tree", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-tree-object",
        "wikg://book.wikg/chapter/tree",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q42", "related", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "entity-object",
        "related",
        "wikg://book.wikg/entity/Q42",
      ),
      kind: "help",
    });
    expect(() => parseCLIArguments(["help", "verb", "get"])).toThrow(
      "Unexpected positional arguments: get.",
    );
    expect(() => parseCLIArguments(["help", "get"])).toThrow(
      "Invalid help topic: get.",
    );
    expect(() => parseCLIArguments(["help", "matrix"])).toThrow(
      "Invalid help topic: matrix.",
    );
  });

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

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of format, config, runtime, uri, recipe, readiness.\nSee: wg --help",
    );
    expect(() =>
      parseCLIArguments(["help", "object", "entity", "extra"]),
    ).toThrow("Unexpected positional arguments: entity extra.");
    expect(() => parseCLIArguments(["help", "verb", "get", "extra"])).toThrow(
      "Unexpected positional arguments: get extra.",
    );
    expect(() =>
      parseCLIArguments(["help", "recipe", "--input", "book.epub"]),
    ).toThrow("The `help` command does not support --input.\nSee: wg --help");
    expect(() =>
      parseCLIArguments(["help", "runtime", "--llm", '{"model":"cli-model"}']),
    ).toThrow("The `help` command does not support --llm.\nSee: wg --help");
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const uriHelpText = renderHelpTopicText("uri");

    expect(rootHelpText).toContain("wg help [topic]");
    expect(rootHelpText).toContain("wg help recipe");
    expect(rootHelpText).toContain("wg help readiness");
    expect(rootHelpText).toContain("Core concepts:");
    expect(rootHelpText).toContain("knowledge-base archives");
    expect(rootHelpText).toContain("Do not edit archive internals:");
    expect(rootHelpText).toContain("zip-based archive");
    expect(rootHelpText).toContain("Agents must not unzip it");
    expect(rootHelpText).toContain(
      "Direct internal edits can break consistency",
    );
    expect(rootHelpText).toContain(
      "Use the CLI's retrieval, generation, metadata, chapter, config, and maintenance commands",
    );
    expect(rootHelpText).toContain("Knowledge-base contents:");
    expect(rootHelpText).toContain(
      "Knowledge Graph: entity and predicate networks",
    );
    expect(rootHelpText).toContain("Reading Graph: attention chunks");
    expect(rootHelpText).toContain("Summaries: compressed reading outputs");
    expect(rootHelpText).toContain("Source text: original chapter content");
    expect(rootHelpText).toContain("retrieved efficiently with keywords");
    expect(rootHelpText).toContain("Scope: a URI target");
    expect(rootHelpText).toContain("Object: a URI target");
    expect(rootHelpText).toContain("Predicate: an operation bound to a URI");
    expect(rootHelpText).not.toContain("wg help task");
    expect(rootHelpText).toContain("wg help uri");
    expect(rootHelpText).toContain("wg <archive-uri> inspect");
    expect(rootHelpText).toContain("wg transform");
    expect(rootHelpText).not.toContain("wg import");
    expect(rootHelpText).not.toContain("wg wikg://local/job add");
    expect(rootHelpText).not.toContain("wg <archive-uri>/index build");
    expect(rootHelpText).toContain(
      "The CLI help system is part of the product contract",
    );
    expect(rootHelpText).toContain("Use `wg <uri> --help`");
    expect(rootHelpText).toContain("Treat `wg --help` as the root");
    expect(rootHelpText).toContain("Wiki Graph CLI");
    expect(rootHelpText).not.toContain("wg help overview");
    expect(rootHelpText).not.toContain("wg help retrieval");
    expect(rootHelpText).not.toContain("wg help command");
    expect(rootHelpText).toContain("wg <uri> <predicate> --help");
    expect(rootHelpText).toContain("Important object families:");
    expect(rootHelpText).toContain("What to learn where:");
    expect(renderHelpTopicText("runtime")).toContain(
      "Runtime and Debug Behavior",
    );
    expect(renderHelpTopicText("config")).toContain("Configuration");
    expect(renderHelpTopicText("readiness")).toContain("FTS readiness:");
    expect(renderHelpTopicText("readiness")).toContain(
      "Without a current index",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "`wg <archive-uri>/index enable` enables the searchable index as local cache outside the `.wikg` archive",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "CLI archive writes keep it synchronized automatically",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index enable --help",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index embed --help",
    );
    expect(renderHelpTopicText("readiness")).toContain("LLM readiness:");
    expect(renderHelpTopicText("readiness")).toContain("WikiSpine readiness:");
    expect(renderHelpTopicText("readiness")).toContain("provider fetch");
    expect(renderHelpTopicText("readiness")).toContain(
      wikispineRuntimeGuideUrl,
    );
    expect(renderHelpTopicText("config")).toContain(wikispineRuntimeGuideUrl);
    expect(
      renderUriHelpText(
        "local-config-section",
        "wikg://local/config/wikispine",
      ),
    ).toContain(wikispineRuntimeGuideUrl);
    expect(
      renderUriPredicateHelpText(
        "local-config-section",
        "test",
        "wikg://local/config/wikispine",
      ),
    ).toContain(wikispineRuntimeGuideUrl);
    expect(renderTransformHelpText()).toContain(
      "This is not a plain file-format converter",
    );
    expect(renderTransformHelpText()).toContain(
      "Source inputs (`epub`, `txt`, `markdown`) call an LLM",
    );
    expect(uriHelpText).toContain("wg <scope-uri> --query <query>");
    expect(uriHelpText).toContain("wg <entity|triple|chunk-uri> evidence");
    expect(uriHelpText).toContain(
      "wg wikg://local/job add --input <archive-uri|chapter-uri>",
    );
    expect(uriHelpText).toContain("wg help format");
    expect(uriHelpText).not.toContain("JSONL contains object records");
    expect(renderHelpTopicText("format")).toContain("Command output shapes:");
    expect(renderHelpTopicText("format")).toContain(
      "Use `--json` when an Agent or script needs one stable machine-readable response.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Whole `source` and `summary` text objects are plain text streams and do not support `--json`.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Ranged fragments such as `/source#20..30` and `/summary#20..30` are structured range objects and support `--json`.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "JSONL may contain both object records and control records.",
    );
    expect(renderHelpTopicText("format")).toContain("--all --jsonl");
    expect(() => parseCLIArguments(["help", "ai"])).toThrow(
      "Invalid help topic: ai.",
    );
    expect(renderHelpTopicText("recipe")).toContain("Operating rules:");
    expect(renderHelpTopicText("recipe")).toContain(
      "Never unzip a `.wikg` archive",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Use Wiki Graph URIs as stable object handles",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Never pass a bare filesystem path to URI-targeted commands.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "/Users/me/book.wikg -> wikg:///Users/me/book.wikg",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/entity --query "attention" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wikg:///absolute/path/book.wikg/entity/Q8018",
    );
    expect(uriHelpText).toContain(
      "Do not pass a bare filesystem path as a command target.",
    );
    expect(uriHelpText).toContain('wg <archive-uri> --query "term"');
    expect(uriHelpText).toContain(
      String.raw`C:\Users\me\book.wikg -> wikg://C:/Users/me/book.wikg`,
    );
    expect(uriHelpText).toContain("Document Flow order:");
    expect(uriHelpText).toContain(
      "`--reverse` cannot be combined with `--query`",
    );
    expect(uriHelpText).toContain(
      "wg <archive-uri>/entity/<qid> evidence --reverse --limit 1",
    );
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "evidence",
        "wikg://book.wikg/entity/Q8018",
      ),
    ).toContain("wg help uri");
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "related",
        "wikg://book.wikg/entity/Q8018",
      ),
    ).toContain("`--reverse` reads Document Flow order backward");
    expect(
      renderUriHelpText("entity-object", "wikg://book.wikg/entity/Q8018"),
    ).toContain("supports `--reverse` without `--query`");
    expect(renderHelpTopicText("format")).toContain(
      "Avoid `--all | head` as a preview pattern.",
    );
    expect(uriHelpText).toContain("Recovery hints:");
    expect(uriHelpText).toContain("No `--query` results:");
    expect(uriHelpText).toContain("Missing generated objects:");
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg:///Users/me/book.wikg --query "attention memory"',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Choose your starting point:",
    );
    expect(renderHelpTopicText("recipe")).toContain("After inspect:");
    expect(renderHelpTopicText("recipe")).toContain("Finding material:");
    expect(renderHelpTopicText("recipe")).toContain(
      "indexed full-text retrieval",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "grep/find with Google-like keyword input",
    );
    expect(renderHelpTopicText("recipe")).toContain("When to read deeper:");
    expect(renderHelpTopicText("recipe")).toContain("wg help readiness");
    expect(renderHelpTopicText("recipe")).toContain(
      "Read the chapter object and use Unix pipes or redirection.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/3/source > chapter-3-source.md",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/3/source#23..45",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/3/summary#23..45",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/entity/Q8018 evidence --reverse --limit 1",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/triple --query "attention memory" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/chunk --query "attention memory" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/entity/Q8018 related --query "memory"',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/entity/Q8018 pack --budget 5000",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Use `--json` when you want stable Agent-readable fields",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "ranged fragments such as `/source#20..30` support `--json`",
    );
    expect(uriHelpText).toContain(
      "Ranged fragments such as `/source#4..8` and `/summary#4..8` are structured range objects.",
    );
    expect(
      renderUriHelpText(
        "chapter-source-object",
        "wikg://book.wikg/chapter/3/source",
      ),
    ).toContain(
      "Whole source reads are plain text streams and do not support `--json`; source range fragments are structured range objects and support `--json`.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/3/entity --all --jsonl",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "If Reading Graph data is missing",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "If Knowledge Graph data is missing",
    );
    expect(uriHelpText).toContain("Command routing:");
    expect(uriHelpText).toContain("wg <archive-uri> create");
    expect(uriHelpText).toContain("wg <archive-uri> export");
    expect(uriHelpText).toContain("wg transform");
    expect(uriHelpText).not.toContain("wg ls");
    expect(renderHelpTopicText("config")).toContain("wikg://local/config/llm");
    expect(renderHelpTopicText("config")).toContain(
      "wikg://local/config/concurrent",
    );
    expect(renderHelpTopicText("config")).toContain("One-run overrides");
    expect(renderHelpTopicText("config")).toContain("baseUrl");
    expect(renderHelpTopicText("config")).toContain(
      "job-local LLM object is stored with the job",
    );
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("does not update `wikg://local/config/llm`");
    expect(
      renderArchiveMaintenanceChapterActionHelpText("set-summary"),
    ).toContain("The chapter must be `reading-graph`");
    expect(renderArchiveMaintenanceChapterActionHelpText("add")).toContain(
      "[--json]",
    );
    expect(
      renderArchiveMaintenanceChapterActionHelpText("set-source"),
    ).toContain("[--json]");
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "[--help|-h]",
    );
    expect(renderArchiveMaintenanceCommandHelpText("meta")).toContain(
      "<object-uri>/meta put <key>",
    );
  });

  it("supports a first-contact recovery chain from root help to parse failures", () => {
    const rootHelpText = renderMainHelpText();

    expect(rootHelpText).not.toContain("wg help overview");
    expect(rootHelpText).not.toContain("wg help command");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--import", "book.pdf"]),
    ).toThrow("See: wg wikg://book.wikg create --help");
    expect(() => parseCLIArguments(["wikg", "inspect"])).toThrow(
      "See: wg --help",
    );
    expect(() => parseCLIArguments(["book.epub"])).toThrow("See: wg --help");
  });
});
