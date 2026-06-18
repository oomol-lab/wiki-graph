import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const mainMockState = vi.hoisted(() => ({
  argsResult: {
    args: {
      action: "status",
      archivePath: "/tmp/book.sdpub",
    },
    help: false,
    kind: "archive" as const,
  } as Record<string, unknown>,
  parseError: undefined as Error | undefined,
  archiveRunCalls: [] as unknown[],
  convertRunCalls: [] as unknown[],
  statusRunCalls: 0,
  statusRunArgs: [] as unknown[],
  archiveChapterRunCalls: [] as unknown[],
  archiveCoverRunCalls: [] as unknown[],
  archiveMetaRunCalls: [] as unknown[],
  archiveRunError: undefined as Error | undefined,
  convertRunError: undefined as Error | undefined,
  statusRunError: undefined as Error | undefined,
  archiveChapterRunError: undefined as Error | undefined,
  archiveCoverRunError: undefined as Error | undefined,
  archiveMetaRunError: undefined as Error | undefined,
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

vi.mock("../../src/cli/convert.js", () => ({
  runConvertCommand: vi.fn((args: unknown) => {
    mainMockState.convertRunCalls.push(args);

    if (mainMockState.convertRunError !== undefined) {
      return Promise.reject(mainMockState.convertRunError);
    }

    return Promise.resolve();
  }),
}));

vi.mock("../../src/cli/status.js", () => ({
  runStatusCommand: vi.fn((args: unknown) => {
    mainMockState.statusRunCalls += 1;
    mainMockState.statusRunArgs.push(args);

    if (mainMockState.statusRunError !== undefined) {
      return Promise.reject(mainMockState.statusRunError);
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
        archivePath: "/tmp/book.sdpub",
      },
      help: false,
      kind: "archive",
    };
    mainMockState.parseError = undefined;
    mainMockState.archiveRunCalls.length = 0;
    mainMockState.convertRunCalls.length = 0;
    mainMockState.statusRunCalls = 0;
    mainMockState.statusRunArgs.length = 0;
    mainMockState.archiveChapterRunCalls.length = 0;
    mainMockState.archiveCoverRunCalls.length = 0;
    mainMockState.archiveMetaRunCalls.length = 0;
    mainMockState.archiveRunError = undefined;
    mainMockState.convertRunError = undefined;
    mainMockState.statusRunError = undefined;
    mainMockState.archiveChapterRunError = undefined;
    mainMockState.archiveCoverRunError = undefined;
    mainMockState.archiveMetaRunError = undefined;
    process.exitCode = 0;
    process.argv = ["node", "spinedigest"];
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
    expect(mainMockState.statusRunCalls).toBe(0);
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
    expect(mainMockState.statusRunCalls).toBe(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive command for normal execution", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.sdpub",
      },
      help: false,
      kind: "archive",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toStrictEqual([
      {
        action: "status",
        archivePath: "/tmp/book.sdpub",
      },
    ]);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(mainMockState.statusRunCalls).toBe(0);
    expect(stdoutChunks).toStrictEqual([]);
    expect(stderrChunks).toStrictEqual([]);
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
    expect(mainMockState.statusRunCalls).toBe(0);
    expect(mainMockState.archiveChapterRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the status command for status execution", async () => {
    mainMockState.argsResult = {
      args: {
        llmJSON: '{"model":"inline-model"}',
      },
      help: false,
      kind: "config-status",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.statusRunCalls).toBe(1);
    expect(mainMockState.statusRunArgs).toStrictEqual([
      {
        llmJSON: '{"model":"inline-model"}',
      },
    ]);
    expect(mainMockState.archiveMetaRunCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive meta command", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.sdpub",
        json: true,
      },
      help: false,
      kind: "meta",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveMetaRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.sdpub",
        json: true,
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive cover command", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.sdpub",
      },
      help: false,
      kind: "cover",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveCoverRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.sdpub",
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("runs the archive chapter command", async () => {
    mainMockState.argsResult = {
      args: {
        action: "list",
        path: "/tmp/book.sdpub",
      },
      help: false,
      kind: "chapter",
    };

    await main();

    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.archiveChapterRunCalls).toStrictEqual([
      {
        action: "list",
        path: "/tmp/book.sdpub",
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("writes parse errors to stderr and sets a non-zero exit code", async () => {
    mainMockState.parseError = new Error("bad args");

    await main();

    expect(stderrChunks).toStrictEqual(["bad args\n"]);
    expect(mainMockState.archiveRunCalls).toHaveLength(0);
    expect(mainMockState.statusRunCalls).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it("writes archive command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.sdpub",
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
        archivePath: "/tmp/book.sdpub",
      },
    ]);
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

  it("writes status command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        llmJSON: '{"model":"inline-model"}',
      },
      help: false,
      kind: "config-status",
    };
    mainMockState.statusRunError = new Error("status failed");

    await main();

    expect(stderrChunks).toStrictEqual(["status failed\n"]);
    expect(mainMockState.statusRunCalls).toBe(1);
    expect(mainMockState.statusRunArgs).toStrictEqual([
      {
        llmJSON: '{"model":"inline-model"}',
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("writes archive maintenance command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = {
      args: {
        inputPath: "/tmp/book.sdpub",
      },
      help: false,
      kind: "meta",
    };
    mainMockState.archiveMetaRunError = new Error("metadata failed");

    await main();

    expect(stderrChunks).toStrictEqual(["metadata failed\n"]);
    expect(mainMockState.archiveMetaRunCalls).toStrictEqual([
      {
        inputPath: "/tmp/book.sdpub",
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("writes the full cause chain to stderr", async () => {
    mainMockState.argsResult = {
      args: {
        action: "status",
        archivePath: "/tmp/book.sdpub",
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
        archivePath: "/tmp/book.sdpub",
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
