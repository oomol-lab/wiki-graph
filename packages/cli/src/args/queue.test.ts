import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import { renderUriHelpText } from "./help.js";

describe("cli/args/queue", () => {
  const archivePath = resolve("book.wikg");

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
});
