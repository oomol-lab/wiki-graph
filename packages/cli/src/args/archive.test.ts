import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";

describe("cli/args/archive", () => {
  const archivePath = resolve("book.wikg");

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
        "wikg://book.wikg/chapter/part/triple/_/_/Q2",
        "--query",
        "agent",
      ]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: `wikg://${archivePath}/chapter/part`,
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
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/part", "inspect"]),
    ).toThrow("`chapter/<path>` inspect is not available");
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
      parseCLIArguments(["wikg://book.wikg/chapter/part/summary", "pack"]),
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
    expect(parseCLIArguments(["wikg://book.wikg/chapter/part"])).toStrictEqual({
      args: {
        action: "list",
        archivePath: `wikg://${archivePath}/chapter/part`,
        format: "text",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part", "--query", "agent"]),
    ).toStrictEqual({
      args: {
        action: "search",
        archivePath: `wikg://${archivePath}/chapter/part`,
        format: "text",
        query: "agent",
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/part", "get"]),
    ).toThrow("This command form is not available.");
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part/title"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: `wikg://${archivePath}/chapter/part/title`,
        format: "text",
        objectId: `wikg://${archivePath}/chapter/part/title`,
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source",
        "--query",
        "x",
      ]),
    ).toThrow("`--query` requires a scope URI");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/triple/Q1/mentions",
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
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/triple/Q1/mentions/Q2",
      ]),
    ).toMatchObject({
      args: {
        action: "get",
        objectId: "wikg://book.wikg/chapter/part/triple/Q1/mentions/Q2",
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
        "wikg://book.wikg/chapter/part/source",
        "set",
        "--input",
        "chapter.md",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-source",
        chapterPath: "part",
        inputPath: "chapter.md",
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source",
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
        "part",
      ]),
    ).toStrictEqual({
      args: {
        action: "add",
        parentChapterPath: "part",
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
        "wikg://book.wikg/chapter/intro",
        "move",
        "--parent",
        "part",
        "--first",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterPath: "intro",
        first: true,
        parentChapterPath: "part",
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/intro",
        "move",
        "--parent",
        "wikg://chapter/part",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterPath: "intro",
        parentChapterPath: "part",
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/intro",
        "move",
        "--before",
        "wikg://book.wikg/chapter/appendix",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        beforeChapterPath: "appendix",
        chapterPath: "intro",
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/intro",
        "move",
        "--parent",
        "wikg://other.wikg/chapter/part",
      ]),
    ).toThrow("Chapter URI belongs to a different archive.");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/intro",
        "move",
        "--root",
        "--last",
      ]),
    ).toStrictEqual({
      args: {
        action: "move",
        chapterPath: "intro",
        last: true,
        moveToRoot: true,
        path: archivePath,
      },
      help: false,
      kind: "chapter",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part",
        "reset",
        "--to",
        "source",
      ]),
    ).toStrictEqual({
      args: {
        action: "reset",
        chapterPath: "part",
        path: archivePath,
        resetStage: "sourced",
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/title",
        "set",
        "--clear",
      ]),
    ).toThrow("does not support --clear. Use `clear`.");
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part/title", "clear"]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterPath: "part",
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
      parseCLIArguments(["wikg://book.wikg/chapter/part/state"]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/chapter/part/state",
        format: "text",
        objectId: "wikg://book.wikg/chapter/part/state",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/state/reading-graph",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "get",
        archivePath: "wikg://book.wikg/chapter/part/state/reading-graph",
        format: "json",
        objectId: "wikg://book.wikg/chapter/part/state/reading-graph",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part/entity"]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: `wikg://${archivePath}/chapter/part`,
        format: "text",
        kinds: ["entity"],
      },
      help: false,
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/part", "status"]),
    ).toThrow("The URI-first form does not support `status`.");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/title",
        "set",
        "--help",
      ]),
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
        "wikg://book.wikg/chapter/part/title",
        "set",
        "Renamed Chapter",
      ]),
    ).toStrictEqual({
      args: {
        action: "set-title",
        chapterPath: "part",
        path: archivePath,
        title: "Renamed Chapter",
      },
      help: false,
      kind: "chapter",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/intro",
        "move",
        "--parent",
        "part",
        "--root",
      ]),
    ).toThrow("Choose only one parent target");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/title",
        "set",
        "--title",
        "Title",
        "--clear",
      ]),
    ).toThrow("does not support --clear. Use `clear`.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/summary",
        "set",
        "--import",
        "book.epub",
      ]),
    ).toThrow("The `chapter set-summary` action does not support --import.");
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/title",
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
});
