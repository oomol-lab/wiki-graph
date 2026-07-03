import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const cliMockState = vi.hoisted(() => ({
  appConstructorOptions: [] as unknown[],
  buildLLMOptionsConfig: [] as unknown[],
  config: {} as Record<string, unknown>,
  createTemporaryOutputPathCalls: [] as Array<{
    readonly extension: string;
    readonly prefix: string;
  }>,
  digestCalls: {
    epub: [] as unknown[],
    markdown: [] as unknown[],
    textStream: [] as unknown[],
    txt: [] as unknown[],
  },
  exportCalls: [] as Array<{
    readonly method: "exportEpub" | "exportText" | "saveAs";
    readonly path: string;
  }>,
  loadCLIConfigOptions: [] as unknown[],
  openCalls: [] as string[],
  resetDigestDirCalls: [] as string[],
  removeTemporaryDirectoryCalls: [] as string[],
  stderrWrites: [] as string[],
  stdoutWrites: [] as string[],
}));

const mockLLMOptions = {
  model: {
    provider: "mock-model",
  },
};

const mockTemporaryOutput = {
  directoryPath: "/tmp/wikigraph-cli-output-temp",
  filePath: "/tmp/wikigraph-cli-output-temp/output.txt",
};

const mockStdinStream = ["from stdin"];

vi.mock("../../src/index.js", () => ({
  SpineDigestApp: class {
    public constructor(options: unknown) {
      cliMockState.appConstructorOptions.push(options);
    }

    public async openSession(
      path: string,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.openCalls.push(path);
      return await operation(createMockDigest());
    }

    public async digestEpubSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.epub.push(options);
      await emitMockProgress(options);
      return await operation(createMockDigest());
    }

    public async digestMarkdownSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.markdown.push(options);
      await emitMockProgress(options);
      return await operation(createMockDigest());
    }

    public async digestTextStreamSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.textStream.push(options);
      await emitMockProgress(options);
      return await operation(createMockDigest());
    }

    public async digestTxtSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.txt.push(options);
      await emitMockProgress(options);
      return await operation(createMockDigest());
    }
  },
}));

vi.mock("../../src/cli/config.js", () => ({
  loadCLIConfig: vi.fn((options?: unknown) => {
    cliMockState.loadCLIConfigOptions.push(options);
    return Promise.resolve(cliMockState.config);
  }),
}));

vi.mock("../../src/cli/llm.js", () => ({
  buildLLMOptions: vi.fn((config: unknown) => {
    cliMockState.buildLLMOptionsConfig.push(config);
    return mockLLMOptions;
  }),
}));

vi.mock("../../src/cli/io.js", () => ({
  createTemporaryOutputPath: vi.fn((prefix: string, extension: string) => {
    cliMockState.createTemporaryOutputPathCalls.push({
      extension,
      prefix,
    });
    return Promise.resolve(mockTemporaryOutput);
  }),
  readTextStreamFromStdin: vi.fn(() => mockStdinStream),
  removeTemporaryDirectory: vi.fn((directoryPath: string) => {
    cliMockState.removeTemporaryDirectoryCalls.push(directoryPath);
    return Promise.resolve();
  }),
  writeTextFileToStdout: vi.fn((path: string) => {
    cliMockState.stdoutWrites.push(path);
    return Promise.resolve();
  }),
}));

vi.mock("fs/promises", () => ({
  rm: vi.fn((path: string) => {
    cliMockState.resetDigestDirCalls.push(path);
    return Promise.resolve();
  }),
}));

import { runConvertCommand } from "../../src/cli/convert.js";

describe("cli/convert", () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    cliMockState.stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);

  beforeEach(() => {
    cliMockState.appConstructorOptions.length = 0;
    cliMockState.buildLLMOptionsConfig.length = 0;
    cliMockState.createTemporaryOutputPathCalls.length = 0;
    cliMockState.digestCalls.epub.length = 0;
    cliMockState.digestCalls.markdown.length = 0;
    cliMockState.digestCalls.textStream.length = 0;
    cliMockState.digestCalls.txt.length = 0;
    cliMockState.exportCalls.length = 0;
    cliMockState.loadCLIConfigOptions.length = 0;
    cliMockState.openCalls.length = 0;
    cliMockState.resetDigestDirCalls.length = 0;
    cliMockState.removeTemporaryDirectoryCalls.length = 0;
    cliMockState.stderrWrites.length = 0;
    cliMockState.stdoutWrites.length = 0;
    cliMockState.config = {};
    setStdinTTY(false);
    setStderrTTY(false);
  });

  afterEach(() => {
    setStdinTTY(originalStdinIsTTY);
    setStderrTTY(originalStderrIsTTY);
  });

  afterAll(() => {
    stderrWriteSpy.mockRestore();
  });

  it("opens wikg input without requiring llm configuration", async () => {
    await runConvertCommand({
      digestDirPath: "/tmp/kept-digest",
      help: false,
      inputPath: "/tmp/book.wikg",
      outputPath: "/tmp/output.txt",
      verbose: false,
    });

    expect(cliMockState.appConstructorOptions).toStrictEqual([{}]);
    expect(cliMockState.openCalls).toStrictEqual(["/tmp/book.wikg"]);
    expect(cliMockState.resetDigestDirCalls).toStrictEqual([]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "exportText",
        path: "/tmp/output.txt",
      },
    ]);
    expect(cliMockState.digestCalls.epub).toHaveLength(0);
    expect(cliMockState.buildLLMOptionsConfig).toHaveLength(0);
  });

  it("digests stdin text to stdout through a temporary text file", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      prompt: "Keep the main beats",
    };

    await runConvertCommand({
      digestDirPath: "/tmp/kept-digest",
      help: false,
      inputFormat: "txt",
      outputFormat: "markdown",
      verbose: false,
    });

    expect(cliMockState.appConstructorOptions).toStrictEqual([
      {
        llm: mockLLMOptions,
      },
    ]);
    expect(cliMockState.buildLLMOptionsConfig).toStrictEqual([
      cliMockState.config,
    ]);
    expect(cliMockState.resetDigestDirCalls).toStrictEqual([
      "/tmp/kept-digest",
    ]);
    expect(cliMockState.digestCalls.textStream).toHaveLength(1);
    expect(cliMockState.digestCalls.textStream[0]).toStrictEqual({
      documentDirPath: "/tmp/kept-digest",
      extractionPrompt: "Keep the main beats",
      sourceFormat: "txt",
      stream: mockStdinStream,
      targetStage: "summarized",
    });
    expect(cliMockState.digestCalls.textStream[0]).not.toHaveProperty(
      "onProgress",
    );
    expect(cliMockState.stderrWrites).toStrictEqual([]);
    expect(cliMockState.createTemporaryOutputPathCalls).toStrictEqual([
      {
        extension: ".md",
        prefix: "wikigraph-cli-output-",
      },
    ]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "exportText",
        path: mockTemporaryOutput.filePath,
      },
    ]);
    expect(cliMockState.stdoutWrites).toStrictEqual([
      mockTemporaryOutput.filePath,
    ]);
    expect(cliMockState.removeTemporaryDirectoryCalls).toStrictEqual([
      mockTemporaryOutput.directoryPath,
    ]);
  });

  it("lets --prompt override the configured extraction prompt", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      prompt: "Configured prompt",
    };

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.txt",
      outputPath: "/tmp/output.txt",
      prompt: "CLI prompt",
      verbose: false,
    });

    expect(cliMockState.digestCalls.txt).toStrictEqual([
      {
        extractionPrompt: "CLI prompt",
        path: "/tmp/book.txt",
        targetStage: "summarized",
      },
    ]);
  });

  it("passes inline llm json into config loading", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.txt",
      llmJSON: '{"model":"inline-model"}',
      outputPath: "/tmp/output.txt",
      verbose: false,
    });

    expect(cliMockState.loadCLIConfigOptions).toStrictEqual([
      {
        llmJSON: '{"model":"inline-model"}',
      },
    ]);
    expect(cliMockState.buildLLMOptionsConfig).toStrictEqual([
      cliMockState.config,
    ]);
  });

  it("accepts inline llm json while reopening wikg without building llm options", async () => {
    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.wikg",
      llmJSON: '{"model":"inline-model"}',
      outputPath: "/tmp/output.txt",
      verbose: false,
    });

    expect(cliMockState.loadCLIConfigOptions).toStrictEqual([
      {
        llmJSON: '{"model":"inline-model"}',
      },
    ]);
    expect(cliMockState.buildLLMOptionsConfig).toHaveLength(0);
    expect(cliMockState.openCalls).toStrictEqual(["/tmp/book.wikg"]);
  });

  it("refuses to read interactive stdin when input is omitted", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };
    setStdinTTY(true);

    await expect(
      runConvertCommand({
        help: false,
        inputFormat: "txt",
        outputPath: "/tmp/output.txt",
        verbose: false,
      }),
    ).rejects.toThrow(
      "Missing --input. Refusing to read from interactive stdin. Use --input <path> or pipe text into stdin.\nSee: wikigraph help runtime",
    );

    expect(cliMockState.digestCalls.textStream).toHaveLength(0);
  });

  it("routes epub inputs through digestEpubSession and saves wikg output", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      prompt: "Keep the main beats",
    };

    await runConvertCommand({
      digestDirPath: "/tmp/kept-digest",
      help: false,
      inputPath: "/tmp/book.epub",
      outputPath: "/tmp/output.wikg",
      verbose: false,
    });

    expect(cliMockState.digestCalls.epub).toStrictEqual([
      {
        documentDirPath: "/tmp/kept-digest",
        extractionPrompt: "Keep the main beats",
        path: "/tmp/book.epub",
        targetStage: "summarized",
      },
    ]);
    expect(cliMockState.resetDigestDirCalls).toStrictEqual([
      "/tmp/kept-digest",
    ]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "saveAs",
        path: "/tmp/output.wikg",
      },
    ]);
  });

  it("rejects digest inputs when llm configuration is missing", async () => {
    cliMockState.config = {};

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/output.txt",
        verbose: false,
      }),
    ).rejects.toThrow(
      "Missing LLM configuration. Set --llm for one run, or configure `wikg://local/config/llm` with provider and model.\nSee: wikigraph help config",
    );

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
    expect(cliMockState.digestCalls.txt).toHaveLength(0);
  });

  it("creates sourced wikg output without llm configuration", async () => {
    cliMockState.config = {};

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.txt",
      outputPath: "/tmp/output.wikg",
      targetStage: "sourced",
      verbose: false,
    });

    expect(cliMockState.appConstructorOptions).toStrictEqual([{}]);
    expect(cliMockState.buildLLMOptionsConfig).toHaveLength(0);
    expect(cliMockState.digestCalls.txt).toStrictEqual([
      {
        path: "/tmp/book.txt",
        targetStage: "sourced",
      },
    ]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "saveAs",
        path: "/tmp/output.wikg",
      },
    ]);
  });

  it("rejects --stage outside source-to-wikg conversion", async () => {
    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/output.txt",
        targetStage: "sourced",
        verbose: false,
      }),
    ).rejects.toThrow(
      "--stage is only supported when output format is wikg.\nSee: wikigraph help command",
    );

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.wikg",
        outputPath: "/tmp/output.wikg",
        targetStage: "sourced",
        verbose: false,
      }),
    ).rejects.toThrow(
      "--stage is only supported when creating .wikg from source input.\nSee: wikigraph help command",
    );
  });

  it("rejects stdin input when the format cannot be inferred", async () => {
    await expect(
      runConvertCommand({
        help: false,
        outputFormat: "txt",
        verbose: false,
      }),
    ).rejects.toThrow(
      "Cannot infer input format from stdin. Set --input-format.\nSee: wikigraph help format",
    );

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
  });

  it("rejects non-text stdout outputs before any app work starts", async () => {
    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.wikg",
        outputFormat: "wikg",
        verbose: false,
      }),
    ).rejects.toThrow(
      "stdout only supports txt or markdown, but got wikg.\nSee: wikigraph help format",
    );

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
    expect(cliMockState.openCalls).toHaveLength(0);
  });

  it("rejects --verbose when writing digest output to stdout", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputFormat: "txt",
        verbose: true,
      }),
    ).rejects.toThrow(
      "Cannot use --verbose when writing digest output to stdout. Use --output <path> or disable --verbose.\nSee: wikigraph help runtime",
    );

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
    expect(cliMockState.digestCalls.txt).toHaveLength(0);
  });

  it("passes verbose through app options when --verbose is enabled", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.txt",
      outputPath: "/tmp/output.txt",
      verbose: true,
    });

    expect(cliMockState.appConstructorOptions).toHaveLength(1);
    expect(cliMockState.appConstructorOptions[0]).toMatchObject({
      llm: mockLLMOptions,
      verbose: true,
    });
    expect(cliMockState.digestCalls.txt[0]).not.toHaveProperty("onProgress");
  });

  it("supports recovery from config and runtime failures", async () => {
    cliMockState.config = {};

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/output.txt",
        verbose: false,
      }),
    ).rejects.toThrow("See: wikigraph help config");

    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputFormat: "txt",
        verbose: true,
      }),
    ).rejects.toThrow("See: wikigraph help runtime");
  });

  it("renders digest progress to stderr for interactive file output", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };
    setStderrTTY(true);

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.txt",
      outputPath: "/tmp/output.txt",
      verbose: false,
    });

    expect(cliMockState.digestCalls.txt[0]).toHaveProperty("onProgress");
    expect(
      cliMockState.stderrWrites.some((chunk) => chunk.includes("Serial")),
    ).toBe(true);
    expect(
      cliMockState.stderrWrites.some((chunk) => chunk.includes("#1")),
    ).toBe(true);
  });
});

interface MockDigest {
  exportEpub(path: string): Promise<void>;
  exportText(path: string): Promise<void>;
  saveAs(path: string): Promise<void>;
}

function createMockDigest(): MockDigest {
  return {
    exportEpub: (path: string) => {
      cliMockState.exportCalls.push({
        method: "exportEpub",
        path,
      });
      return Promise.resolve();
    },
    exportText: (path: string) => {
      cliMockState.exportCalls.push({
        method: "exportText",
        path,
      });
      return Promise.resolve();
    },
    saveAs: (path: string) => {
      cliMockState.exportCalls.push({
        method: "saveAs",
        path,
      });
      return Promise.resolve();
    },
  };
}

async function emitMockProgress(options: unknown): Promise<void> {
  const onProgress =
    typeof (options as { readonly onProgress?: unknown }).onProgress ===
    "function"
      ? (
          options as {
            readonly onProgress: (event: unknown) => Promise<void> | void;
          }
        ).onProgress
      : undefined;

  if (onProgress === undefined) {
    return;
  }

  await onProgress({
    available: true,
    serials: [
      {
        fragments: 6,
        id: 1,
        words: 4800,
      },
    ],
    type: "serials-discovered",
  });
  await onProgress({
    completedWords: 0,
    totalWords: 4800,
    type: "digest-progress",
  });
  await onProgress({
    completedFragments: 3,
    completedWords: 2300,
    id: 1,
    type: "serial-progress",
  });
  await onProgress({
    completedWords: 2300,
    totalWords: 4800,
    type: "digest-progress",
  });
}

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}

function setStderrTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value,
  });
}
