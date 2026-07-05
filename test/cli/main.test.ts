import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const mainMockState = vi.hoisted(() => ({
  argsResult: {
    args: {
      action: "status",
      archivePath: "/tmp/book.wikg",
    },
    help: false,
    kind: "archive" as const,
  } as Record<string, unknown>,
  parseError: undefined as Error | undefined,
  archiveRunCalls: [] as unknown[],
  archiveIndexRunCalls: [] as unknown[],
  convertRunCalls: [] as unknown[],
  localConfigRunCalls: [] as unknown[],
  gcRunCalls: [] as unknown[],
  archiveChapterRunCalls: [] as unknown[],
  archiveCoverRunCalls: [] as unknown[],
  archiveMetaRunCalls: [] as unknown[],
  legacyRunCalls: [] as unknown[],
  archiveRunError: undefined as Error | undefined,
  archiveIndexRunError: undefined as Error | undefined,
  convertRunError: undefined as Error | undefined,
  localConfigRunError: undefined as Error | undefined,
  gcRunError: undefined as Error | undefined,
  archiveChapterRunError: undefined as Error | undefined,
  archiveCoverRunError: undefined as Error | undefined,
  archiveMetaRunError: undefined as Error | undefined,
  legacyRunError: undefined as Error | undefined,
}));

vi.mock("../../src/cli/args.js", () => ({
  parseCLIArguments: vi.fn(() => {
    if (mainMockState.parseError !== undefined) {
      throw mainMockState.parseError;
    }

    return mainMockState.argsResult;
  }),
}));

vi.mock("../../src/cli/archive.js", () => ({
  runArchiveCommand: vi.fn((args: unknown) => {
    mainMockState.archiveRunCalls.push(args);

    if (mainMockState.archiveRunError !== undefined) {
      return Promise.reject(mainMockState.archiveRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/archive-index.js", () => ({
  runArchiveIndexCommand: vi.fn((args: unknown) => {
    mainMockState.archiveIndexRunCalls.push(args);

    if (mainMockState.archiveIndexRunError !== undefined) {
      return Promise.reject(mainMockState.archiveIndexRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/convert.js", () => ({
  runConvertCommand: vi.fn((args: unknown) => {
    mainMockState.convertRunCalls.push(args);

    if (mainMockState.convertRunError !== undefined) {
      return Promise.reject(mainMockState.convertRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/local-config.js", () => ({
  runLocalConfigCommand: vi.fn((args: unknown) => {
    mainMockState.localConfigRunCalls.push(args);

    if (mainMockState.localConfigRunError !== undefined) {
      return Promise.reject(mainMockState.localConfigRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/gc.js", () => ({
  runGcCommand: vi.fn((args: unknown) => {
    mainMockState.gcRunCalls.push(args);

    if (mainMockState.gcRunError !== undefined) {
      return Promise.reject(mainMockState.gcRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/archive-maintenance.js", () => ({
  runArchiveCoverCommand: vi.fn((args: unknown) => {
    mainMockState.archiveCoverRunCalls.push(args);

    if (mainMockState.archiveCoverRunError !== undefined) {
      return Promise.reject(mainMockState.archiveCoverRunError);
    }

    return Promise.resolve();
  }),
  runArchiveMetaCommand: vi.fn((args: unknown) => {
    mainMockState.archiveMetaRunCalls.push(args);

    if (mainMockState.archiveMetaRunError !== undefined) {
      return Promise.reject(mainMockState.archiveMetaRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/archive-chapter.js", () => ({
  runArchiveChapterCommand: vi.fn((args: unknown) => {
    mainMockState.archiveChapterRunCalls.push(args);

    if (mainMockState.archiveChapterRunError !== undefined) {
      return Promise.reject(mainMockState.archiveChapterRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/legacy.js", () => ({
  runLegacyCommand: vi.fn((args: unknown) => {
    mainMockState.legacyRunCalls.push(args);

    if (mainMockState.legacyRunError !== undefined) {
      return Promise.reject(mainMockState.legacyRunError);
    }

    return Promise.resolve();
  }),
}));

import { main } from "../../src/cli/main.js";
import { renderMainHelpText } from "../../src/cli/help.js";
import { LLMPaymentRequiredError } from "../../src/llm/index.js";

describe("cli/main", () => {
  const originalExitCode = process.exitCode;
  const originalArgv = process.argv;
  const originalStdinIsTTY = process.stdin.isTTY;
  let stdoutWrite: MockInstance;
  let stderrWrite: MockInstance;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.parseError = undefined;
    mainMockState.archiveRunCalls.length = 0;
    mainMockState.archiveIndexRunCalls.length = 0;
    mainMockState.convertRunCalls.length = 0;
    mainMockState.localConfigRunCalls.length = 0;
    mainMockState.gcRunCalls.length = 0;
    mainMockState.archiveChapterRunCalls.length = 0;
    mainMockState.archiveCoverRunCalls.length = 0;
    mainMockState.archiveMetaRunCalls.length = 0;
    mainMockState.legacyRunCalls.length = 0;
    mainMockState.archiveRunError = undefined;
    mainMockState.archiveIndexRunError = undefined;
    mainMockState.convertRunError = undefined;
    mainMockState.localConfigRunError = undefined;
    mainMockState.gcRunError = undefined;
    mainMockState.archiveChapterRunError = undefined;
    mainMockState.archiveCoverRunError = undefined;
    mainMockState.archiveMetaRunError = undefined;
    mainMockState.legacyRunError = undefined;
    process.exitCode = 0;
    process.argv = ["node", "wikigraph"];
    setStdinTTY(false);
    stdoutChunks = [];
    stderrChunks = [];
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      });
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    process.exitCode = originalExitCode;
    process.argv = originalArgv;
    setStdinTTY(originalStdinIsTTY);
  });

  it("prints root help for a bare interactive invocation", async () => {
    setStdinTTY(true);

    await main();

    expect(stdoutChunks).toStrictEqual([`${renderMainHelpText()}\n`]);
    expect(stderrChunks).toStrictEqual([]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("prints help text and skips command execution when --help is used", async () => {
    mainMockState.argsResult = {
      help: true,
      helpText: "CLI HELP",
      kind: "help",
    };

    await main();

    expect(stdoutChunks).toStrictEqual(["CLI HELP\n"]);
    expect(stderrChunks).toStrictEqual([]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive command for normal execution", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toStrictEqual([
      {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
    ]);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(stdoutChunks).toStrictEqual([]);
    expect(stderrChunks).toStrictEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive index command", async () => {
    mainMockState.argsResult = {
      args: {
        action: "enable",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive-index",
    };

    await main();

    expect(mainMockState.archiveIndexRunCalls).toStrictEqual([
      {
        action: "enable",
        archivePath: "/tmp/book.wikg",
      },
    ]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the transform command for direct conversion", async () => {
    mainMockState.argsResult = {
      args: {
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/out.txt",
        verbose: false,
      },
      help: false,
      kind: "convert",
    };

    await main();

    expect(mainMockState.convertRunCalls).toStrictEqual([
      {
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/out.txt",
        verbose: false,
      },
    ]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(stdoutChunks).toStrictEqual([]);
    expect(stderrChunks).toStrictEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the legacy command for migration", async () => {
    mainMockState.argsResult = {
      args: {
        action: "migrate",
        inputPath: "/tmp/book.sdpub",
        outputPath: "/tmp/book.wikg",
      },
      help: false,
      kind: "legacy",
    };

    await main();

    expect(mainMockState.legacyRunCalls).toStrictEqual([
      {
        action: "migrate",
        inputPath: "/tmp/book.sdpub",
        outputPath: "/tmp/book.wikg",
      },
    ]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(stdoutChunks).toStrictEqual([]);
    expect(stderrChunks).toStrictEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("prints the package version and skips commands", async () => {
    mainMockState.argsResult = {
      help: false,
      kind: "version",
    };

    await main();

    expect(stdoutChunks).toHaveLength(1);
    expect(stdoutChunks[0]).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(stderrChunks).toStrictEqual([]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(mainMockState.archiveChapterRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the local config command", async () => {
    mainMockState.argsResult = {
      args: {
        action: "get",
        section: "llm",
      },
      help: false,
      kind: "local-config",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toStrictEqual([
      {
        action: "get",
        section: "llm",
      },
    ]);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the gc command", async () => {
    mainMockState.argsResult = {
      args: {
        dryRun: true,
        force: true,
        json: true,
      },
      help: false,
      kind: "gc",
    };

    await main();

    expect(mainMockState.gcRunCalls).toStrictEqual([
      { dryRun: true, force: true, json: true },
    ]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive meta command", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.wikg",
        json: true,
      },
      help: false,
      kind: "meta",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.wikg",
        json: true,
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive cover command", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.wikg",
      },
      help: false,
      kind: "cover",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveCoverRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.wikg",
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive chapter command", async () => {
    mainMockState.argsResult = {
      args: {
        action: "list",
        path: "/tmp/book.wikg",
      },
      help: false,
      kind: "chapter",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveChapterRunCalls).toStrictEqual([
      {
        action: "list",
        path: "/tmp/book.wikg",
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("writes parse errors to stderr and sets a non-zero exit code", async () => {
    mainMockState.parseError = new Error("bad args");

    await main();

    expect(stderrChunks).toStrictEqual(["bad args\n"]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.localConfigRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("writes archive command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.archiveRunError = new Error("archive failed");

    await main();

    expect(stderrChunks).toStrictEqual(["archive failed\n"]);
    expect(mainMockState.archiveRunCalls).toStrictEqual([
      {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("writes archive command failures as JSON when --json is requested", async () => {
    process.argv = [
      "node",
      "wikigraph",
      "get",
      "/tmp/book.wikg",
      "wikg://entity/Q1",
      "--json",
    ];
    mainMockState.argsResult = {
      args: {
        action: "get",
        archivePath: "/tmp/book.wikg",
        format: "json",
        objectId: "wikg://entity/Q1",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.archiveRunError = new Error("entity not found");

    await main();

    expect(stderrChunks).toStrictEqual([]);
    expect(JSON.parse(stdoutChunks.join(""))).toStrictEqual({
      error: {
        message: "entity not found",
        type: "error",
      },
    });
    expect(process.exitCode).toBe(1);
  });

  it("writes parse errors as JSON when --json is requested", async () => {
    process.argv = ["node", "wikigraph", "search", "--json"];
    mainMockState.parseError = new Error("bad args");

    await main();

    expect(stderrChunks).toStrictEqual([]);
    expect(JSON.parse(stdoutChunks.join(""))).toStrictEqual({
      error: {
        message: "bad args",
        type: "error",
      },
    });
    expect(process.exitCode).toBe(1);
  });

  it("writes transform command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        help: false,
        verbose: false,
      },
      help: false,
      kind: "convert",
    };
    mainMockState.convertRunError = new Error("transform failed");

    await main();

    expect(stderrChunks).toStrictEqual(["transform failed\n"]);
    expect(mainMockState.convertRunCalls).toStrictEqual([
      {
        help: false,
        verbose: false,
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("writes archive maintenance command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.wikg",
      },
      help: false,
      kind: "meta",
    };
    mainMockState.archiveMetaRunError = new Error("metadata failed");

    await main();

    expect(stderrChunks).toStrictEqual(["metadata failed\n"]);
    expect(mainMockState.archiveMetaRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.wikg",
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("writes the full cause chain to stderr", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.archiveRunError = new Error("archive failed", {
      cause: new Error("tls reset"),
    });

    await main();

    expect(stderrChunks).toStrictEqual(["archive failed: tls reset\n"]);
    expect(process.exitCode).toBe(1);
  });

  it("writes a stable payment required message for LLM billing failures", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.wikg",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.archiveRunError = new LLMPaymentRequiredError(
      "provider message",
      {
        cause: new Error("raw provider error"),
      },
    );

    await main();

    expect(stderrChunks).toStrictEqual([
      "LLM payment required. Check your provider billing status or account balance.\n",
    ]);
    expect(process.exitCode).toBe(1);
  });
});

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}
