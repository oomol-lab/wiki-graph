import { readdir, readFile } from "fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMockState = vi.hoisted(() => ({
  generateTextResponse: "generated response",
  usage: {
    inputTokenDetails: {
      cacheReadTokens: 3,
    },
    inputTokens: 11,
    outputTokens: 7,
  },
  generateTextCalls: [] as unknown[],
  generateTextError: undefined as Error | undefined,
  generateTextHandler: undefined as
    | ((input: unknown) => Promise<{ readonly text: string }>)
    | undefined,
  streamTextCalls: [] as unknown[],
  streamTextError: undefined as Error | undefined,
}));

vi.mock("ai", () => ({
  APICallError: class extends Error {
    public readonly isRetryable: boolean;
    public readonly statusCode: number | undefined;

    public constructor(
      message: string,
      options: {
        cause?: unknown;
        isRetryable?: boolean;
        statusCode?: number;
      } = {},
    ) {
      super(message, options);
      this.name = "AI_APICallError";
      this.isRetryable = options.isRetryable ?? false;
      this.statusCode = options.statusCode;
    }

    public static isInstance(error: unknown): boolean {
      return error instanceof this;
    }
  },
  generateText: vi.fn((input: unknown) => {
    aiMockState.generateTextCalls.push(input);

    if (aiMockState.generateTextHandler !== undefined) {
      return aiMockState.generateTextHandler(input);
    }

    if (aiMockState.generateTextError !== undefined) {
      return Promise.reject(aiMockState.generateTextError);
    }

    return Promise.resolve({
      text: aiMockState.generateTextResponse,
      usage: aiMockState.usage,
    });
  }),
  streamText: vi.fn((input: unknown) => {
    aiMockState.streamTextCalls.push(input);
    const chunks = ["streamed ", "response"];

    return {
      totalUsage: Promise.resolve(aiMockState.usage),
      textStream: {
        [Symbol.asyncIterator]() {
          let index = 0;

          return {
            next() {
              if (aiMockState.streamTextError !== undefined) {
                return Promise.reject(aiMockState.streamTextError);
              }

              if (index >= chunks.length) {
                return Promise.resolve({
                  done: true as const,
                  value: undefined,
                });
              }

              const value = chunks[index];

              index += 1;

              return Promise.resolve({
                done: false as const,
                value,
              });
            },
          };
        },
      },
    };
  }),
}));

import { WikiGraphScope } from "../../packages/core/src/common/llm-scope.js";
import { LLM } from "../../packages/core/src/llm/client.js";
import { LLMPaymentRequiredError } from "../../packages/core/src/llm/errors.js";
import { withTempDir } from "../helpers/temp.js";

const RETRYABLE_TRANSPORT_CODES = [
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "EAI_AGAIN",
] as const;
const RETRYABLE_HTTP_STATUS_CODES = [
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529,
] as const;

describe("llm/client", () => {
  beforeEach(() => {
    aiMockState.generateTextResponse = "generated response";
    aiMockState.usage = {
      inputTokenDetails: {
        cacheReadTokens: 3,
      },
      inputTokens: 11,
      outputTokens: 7,
    };
    aiMockState.generateTextCalls.length = 0;
    aiMockState.generateTextError = undefined;
    aiMockState.generateTextHandler = undefined;
    aiMockState.streamTextCalls.length = 0;
    aiMockState.streamTextError = undefined;
  });

  it("uses generateText by default", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("generated response");

    expect(llm.config.concurrent).toBe(6);
    expect(llm.config.stream).toBe(false);
    expect(llm.config.timeout).toBe(360000);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly timeout: number;
      },
    ).toMatchObject({
      timeout: 360000,
    });
    expect(aiMockState.streamTextCalls).toHaveLength(0);
  });

  it("reports token usage when the provider returns it", async () => {
    const usages: unknown[] = [];
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      onTokenUsage: (usage) => {
        usages.push(usage);
      },
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("generated response");

    expect(usages).toStrictEqual([
      {
        cacheReadTokens: 3,
        inputTokens: 11,
        outputTokens: 7,
      },
    ]);
  });

  it("writes token usage to request logs when the provider returns it", async () => {
    await withTempDir("wikigraph-llm-log-", async (logDirPath) => {
      const llm = new LLM({
        dataDirPath: process.cwd(),
        logDirPath,
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
      });

      await expect(
        llm.request([
          {
            content: "hello",
            role: "user",
          },
        ]),
      ).resolves.toBe("generated response");

      await expect(readdir(logDirPath)).resolves.toContain("request-1.log");
      await expect(readOnlyRequestLog(logDirPath)).resolves.toContain(
        "[[Usage]]:\ninput: 11\ncache: 3\noutput: 7\n\n",
      );
    });
  });

  it("moves a leading system message to the top-level system field", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await llm.request([
      {
        content: "follow the style guide",
        role: "system",
      },
      {
        content: "hello",
        role: "user",
      },
    ]);

    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly messages: readonly unknown[];
        readonly system?: unknown;
      },
    ).toMatchObject({
      messages: [
        {
          content: "hello",
          role: "user",
        },
      ],
      system: {
        content: "follow the style guide",
        role: "system",
      },
    });
  });

  it("keeps cache keys based on the original messages", async () => {
    await withTempDir("wikigraph-llm-cache-", async (cacheDirPath) => {
      const llm = new LLM({
        cacheDirPath,
        dataDirPath: process.cwd(),
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
      });
      const messages = [
        {
          content: "follow the style guide",
          role: "system",
        },
        {
          content: "hello",
          role: "user",
        },
      ] as const;

      await expect(llm.request(messages)).resolves.toBe("generated response");
      aiMockState.generateTextResponse = "cached response should not be used";

      await expect(llm.request(messages)).resolves.toBe("generated response");

      expect(aiMockState.generateTextCalls).toHaveLength(1);
    });
  });

  it("writes cache-hit usage to request logs for cached responses", async () => {
    await withTempDir("wikigraph-llm-cache-log-", async (path) => {
      const cacheDirPath = `${path}/cache`;
      const logDirPath = `${path}/logs`;
      const llm = new LLM({
        cacheDirPath,
        dataDirPath: process.cwd(),
        logDirPath,
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
      });
      const messages = [
        {
          content: "hello",
          role: "user",
        },
      ] as const;

      await expect(llm.request(messages)).resolves.toBe("generated response");
      await expect(llm.request(messages)).resolves.toBe("generated response");

      const logs = await readRequestLogs(logDirPath);

      expect(logs).toHaveLength(2);
      expect(logs).toContainEqual(
        expect.stringContaining("[[Usage]]:\ncache-hit\n\n"),
      );
      expect(aiMockState.generateTextCalls).toHaveLength(1);
    });
  });

  it("does not use cache for requests without visible non-system content", async () => {
    await withTempDir("wikigraph-llm-empty-cache-", async (cacheDirPath) => {
      const llm = new LLM({
        cacheDirPath,
        dataDirPath: process.cwd(),
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
      });
      const messages = [
        {
          content: "follow the style guide",
          role: "system",
        },
        {
          content: "\n\t ",
          role: "user",
        },
      ] as const;

      await expect(llm.request(messages)).resolves.toBe("generated response");
      aiMockState.generateTextResponse = "second generated response";

      await expect(llm.request(messages)).resolves.toBe(
        "second generated response",
      );

      expect(aiMockState.generateTextCalls).toHaveLength(2);
    });
  });

  it("preserves non-leading system messages in the messages array", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await llm.request([
      {
        content: "hello",
        role: "user",
      },
      {
        content: "follow the style guide",
        role: "system",
      },
    ]);

    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly messages: readonly unknown[];
        readonly system?: unknown;
      },
    ).toMatchObject({
      messages: [
        {
          content: "hello",
          role: "user",
        },
        {
          content: "follow the style guide",
          role: "system",
        },
      ],
    });
    expect(
      (aiMockState.generateTextCalls[0] as { readonly system?: unknown })
        .system,
    ).toBeUndefined();
  });

  it("uses streamText when stream mode is enabled", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      stream: true,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("streamed response");

    expect(llm.config.stream).toBe(true);
    expect(aiMockState.generateTextCalls).toHaveLength(0);
    expect(aiMockState.streamTextCalls).toHaveLength(1);
  });

  it("starts lazy request callbacks only when a request slot is available", async () => {
    const resolvers: Array<() => void> = [];
    let activeProviderRequests = 0;
    let maxActiveProviderRequests = 0;

    aiMockState.generateTextHandler = async () => {
      activeProviderRequests += 1;
      maxActiveProviderRequests = Math.max(
        maxActiveProviderRequests,
        activeProviderRequests,
      );

      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      activeProviderRequests -= 1;
      return { text: "done" };
    };

    const llm = new LLM({
      concurrent: 2,
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });
    let preparedTasks = 0;
    const requests = Array.from({ length: 5 }, (_value, index) =>
      llm.request(async (request) => {
        preparedTasks += 1;
        return await request([
          {
            content: `hello ${index}`,
            role: "user",
          },
        ]);
      }),
    );

    await vi.waitFor(() => {
      expect(preparedTasks).toBe(2);
      expect(aiMockState.generateTextCalls).toHaveLength(2);
    });
    expect(maxActiveProviderRequests).toBe(2);

    resolvers.splice(0, 2).forEach((resolve) => {
      resolve();
    });
    await vi.waitFor(() => {
      expect(preparedTasks).toBe(4);
      expect(aiMockState.generateTextCalls).toHaveLength(4);
    });

    resolvers.splice(0, 2).forEach((resolve) => {
      resolve();
    });
    await vi.waitFor(() => {
      expect(preparedTasks).toBe(5);
      expect(aiMockState.generateTextCalls).toHaveLength(5);
    });

    resolvers.splice(0).forEach((resolve) => {
      resolve();
    });
    await expect(Promise.all(requests)).resolves.toStrictEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(maxActiveProviderRequests).toBe(2);
  });

  it("uses explicit scoped sampling defaults provided by the caller", async () => {
    const llm = new LLM<WikiGraphScope.EditorCompress>({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      sampling: {
        [WikiGraphScope.EditorCompress]: {
          temperature: 0.7,
          topP: 0.9,
        },
      },
    });

    await llm.request(
      [
        {
          content: "hello",
          role: "user",
        },
      ],
      {
        scope: WikiGraphScope.EditorCompress,
      },
    );

    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly temperature: number;
        readonly topP: number;
      },
    ).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
    });
  });

  it("passes explicit timeout values through as milliseconds", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      timeout: 45000,
    });

    await llm.request([
      {
        content: "hello",
        role: "user",
      },
    ]);

    expect(llm.config.timeout).toBe(45000);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly timeout: number;
      },
    ).toMatchObject({
      timeout: 45000,
    });
  });

  it("treats an empty string response as a successful result", async () => {
    aiMockState.generateTextResponse = "";

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("");
    expect(aiMockState.generateTextCalls).toHaveLength(1);
  });

  it("preserves the last retry error as the request cause", async () => {
    const { APICallError } = await import("ai");
    const MockAPICallError = APICallError as unknown as {
      new (
        message: string,
        options?: {
          cause?: unknown;
          isRetryable?: boolean;
          statusCode?: number;
        },
      ): Error;
    };
    const tlsError = Object.assign(
      new Error(
        "Client network socket disconnected before secure TLS connection was established",
      ),
      {
        code: "ECONNRESET",
      },
    );

    aiMockState.generateTextError = new MockAPICallError(
      "Cannot connect to API",
      {
        cause: tlsError,
        isRetryable: true,
      },
    );

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.generateTextError,
      message:
        "LLM request failed after 6 attempts: Cannot connect to API: Client network socket disconnected before secure TLS connection was established (ECONNRESET)",
    });
    expect(aiMockState.generateTextCalls).toHaveLength(6);
  });

  it("retries terminated transport errors for generateText", async () => {
    aiMockState.generateTextError = new TypeError("terminated");

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.generateTextError,
      message: "LLM request failed after 6 attempts: terminated",
    });
    expect(aiMockState.generateTextCalls).toHaveLength(6);
  });

  it("writes unavailable usage and error stack to request logs after failures", async () => {
    await withTempDir("wikigraph-llm-error-log-", async (logDirPath) => {
      aiMockState.generateTextError = new TypeError("terminated");

      const llm = new LLM({
        dataDirPath: process.cwd(),
        logDirPath,
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
        retryIntervalSeconds: 0,
      });

      await expect(
        llm.request([
          {
            content: "hello",
            role: "user",
          },
        ]),
      ).rejects.toThrow("LLM request failed after 6 attempts: terminated");

      const log = await readOnlyRequestLog(logDirPath);

      expect(log).toContain(
        "[[Usage]]:\ninput: unavailable\ncache: unavailable\noutput: unavailable\n\n",
      );
      expect(log).toContain("[[Error Stack]]:\nTypeError: terminated");
    });
  });

  it.each(RETRYABLE_TRANSPORT_CODES)(
    "retries transport errors tagged with %s",
    async (code) => {
      aiMockState.generateTextError = new TypeError("fetch failed", {
        cause: Object.assign(new Error("transport failure"), {
          code,
        }),
      });

      const llm = new LLM({
        dataDirPath: process.cwd(),
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
        retryIntervalSeconds: 0,
      });

      await expect(
        llm.request([
          {
            content: "hello",
            role: "user",
          },
        ]),
      ).rejects.toMatchObject({
        cause: aiMockState.generateTextError,
        message: `LLM request failed after 6 attempts: fetch failed: transport failure (${code})`,
      });
      expect(aiMockState.generateTextCalls).toHaveLength(6);
    },
  );

  it("does not retry abort-like errors", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    aiMockState.generateTextError = abortError;

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toBe(abortError);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
  });

  it.each(RETRYABLE_HTTP_STATUS_CODES)(
    "retries API errors with HTTP status %i",
    async (statusCode) => {
      const { APICallError } = await import("ai");
      const MockAPICallError = APICallError as unknown as {
        new (
          message: string,
          options?: {
            cause?: unknown;
            isRetryable?: boolean;
            statusCode?: number;
          },
        ): Error;
      };

      aiMockState.generateTextError = new MockAPICallError(
        "Transient API error",
        {
          isRetryable: false,
          statusCode,
        },
      );

      const llm = new LLM({
        dataDirPath: process.cwd(),
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
        retryIntervalSeconds: 0,
      });

      await expect(
        llm.request([
          {
            content: "hello",
            role: "user",
          },
        ]),
      ).rejects.toMatchObject({
        cause: aiMockState.generateTextError,
        message: "LLM request failed after 6 attempts: Transient API error",
      });
      expect(aiMockState.generateTextCalls).toHaveLength(6);
    },
  );

  it("does not retry non-retryable API status codes", async () => {
    const { APICallError } = await import("ai");
    const MockAPICallError = APICallError as unknown as {
      new (
        message: string,
        options?: {
          cause?: unknown;
          isRetryable?: boolean;
          statusCode?: number;
        },
      ): Error;
    };

    aiMockState.generateTextError = new MockAPICallError("Bad request", {
      isRetryable: false,
      statusCode: 400,
    });

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toBe(aiMockState.generateTextError);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
  });

  it.each([false, true])(
    "wraps HTTP 402 payment errors without retrying when isRetryable is %s",
    async (isRetryable) => {
      const { APICallError } = await import("ai");
      const MockAPICallError = APICallError as unknown as {
        new (
          message: string,
          options?: {
            cause?: unknown;
            isRetryable?: boolean;
            statusCode?: number;
          },
        ): Error;
      };

      aiMockState.generateTextError = new MockAPICallError("Payment required", {
        isRetryable,
        statusCode: 402,
      });

      const llm = new LLM({
        dataDirPath: process.cwd(),
        model: {
          modelId: "test-model",
          provider: "test-provider",
        } as never,
        retryIntervalSeconds: 0,
      });

      const request = llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]);

      await expect(request).rejects.toMatchObject({
        cause: aiMockState.generateTextError,
        isRetryable: false,
        message: "LLM payment required.",
        statusCode: 402,
      });
      await expect(request).rejects.toBeInstanceOf(LLMPaymentRequiredError);
      expect(aiMockState.generateTextCalls).toHaveLength(1);
    },
  );

  it("retries terminated transport errors for streamText", async () => {
    aiMockState.streamTextError = new TypeError("terminated");

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
      stream: true,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.streamTextError,
      message: "LLM request failed after 6 attempts: terminated",
    });
    expect(aiMockState.streamTextCalls).toHaveLength(6);
  });
});

async function readOnlyRequestLog(logDirPath: string): Promise<string> {
  const logs = await readRequestLogs(logDirPath);

  expect(logs).toHaveLength(1);
  return logs[0]!;
}

async function readRequestLogs(logDirPath: string): Promise<string[]> {
  const entries = await readdir(logDirPath);

  return await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".log"))
      .sort((left, right) => left.localeCompare(right))
      .map(async (entry) => await readFile(`${logDirPath}/${entry}`, "utf8")),
  );
}
