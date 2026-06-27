import { beforeEach, describe, expect, it, vi } from "vitest";

const llmMockState = vi.hoisted(() => ({
  anthropicFactoryCalls: [] as unknown[],
  anthropicModelCalls: [] as string[],
  googleFactoryCalls: [] as unknown[],
  googleModelCalls: [] as string[],
  openAIFactoryCalls: [] as unknown[],
  openAIModelCalls: [] as string[],
  openAICompatibleFactoryCalls: [] as unknown[],
  openAICompatibleModelCalls: [] as string[],
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn((options: unknown) => {
    llmMockState.anthropicFactoryCalls.push(options);

    return (model: string) => {
      llmMockState.anthropicModelCalls.push(model);
      return {
        model,
        provider: "anthropic",
      };
    };
  }),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn((options: unknown) => {
    llmMockState.googleFactoryCalls.push(options);

    return (model: string) => {
      llmMockState.googleModelCalls.push(model);
      return {
        model,
        provider: "google",
      };
    };
  }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn((options: unknown) => {
    llmMockState.openAIFactoryCalls.push(options);

    return (model: string) => {
      llmMockState.openAIModelCalls.push(model);
      return {
        model,
        provider: "openai",
      };
    };
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn((options: unknown) => {
    llmMockState.openAICompatibleFactoryCalls.push(options);

    return (model: string) => {
      llmMockState.openAICompatibleModelCalls.push(model);
      return {
        model,
        provider: "openai-compatible",
      };
    };
  }),
}));

import { buildLLMOptions } from "../../src/cli/llm.js";

describe("cli/llm", () => {
  beforeEach(() => {
    llmMockState.anthropicFactoryCalls.length = 0;
    llmMockState.anthropicModelCalls.length = 0;
    llmMockState.googleFactoryCalls.length = 0;
    llmMockState.googleModelCalls.length = 0;
    llmMockState.openAIFactoryCalls.length = 0;
    llmMockState.openAIModelCalls.length = 0;
    llmMockState.openAICompatibleFactoryCalls.length = 0;
    llmMockState.openAICompatibleModelCalls.length = 0;
  });

  it("builds openai llm options with request and path settings", () => {
    expect(
      buildLLMOptions({
        llm: {
          apiKey: "secret",
          model: "gpt-test",
          name: "custom-openai",
          provider: "openai",
        },
        paths: {
          cacheDir: "/tmp/cache",
          debugLogDir: "/tmp/debug",
        },
        request: {
          concurrent: 3,
          retryIntervalSeconds: 2,
          retryTimes: 4,
          stream: true,
          temperature: [0.2, 0.4],
          timeout: 30000,
          topP: 0.9,
        },
      }),
    ).toStrictEqual({
      cacheDirPath: "/tmp/cache",
      concurrent: 3,
      logDirPath: "/tmp/debug",
      model: {
        model: "gpt-test",
        provider: "openai",
      },
      retryIntervalSeconds: 2,
      retryTimes: 4,
      stream: true,
      temperature: [0.2, 0.4],
      timeout: 30000,
      topP: 0.9,
    });

    expect(llmMockState.openAIFactoryCalls).toStrictEqual([
      {
        apiKey: "secret",
        name: "custom-openai",
      },
    ]);
    expect(llmMockState.openAIModelCalls).toStrictEqual(["gpt-test"]);
  });

  it("builds anthropic and google models with their optional settings", () => {
    const anthropic = buildLLMOptions({
      llm: {
        apiKey: "anthropic-key",
        model: "claude-test",
        name: "anthropic-name",
        provider: "anthropic",
      },
    });
    const google = buildLLMOptions({
      llm: {
        apiKey: "google-key",
        model: "gemini-test",
        name: "google-name",
        provider: "google",
      },
    });

    expect(anthropic.model).toStrictEqual({
      model: "claude-test",
      provider: "anthropic",
    });
    expect(google.model).toStrictEqual({
      model: "gemini-test",
      provider: "google",
    });
    expect(llmMockState.anthropicFactoryCalls).toStrictEqual([
      {
        apiKey: "anthropic-key",
        name: "anthropic-name",
      },
    ]);
    expect(llmMockState.googleFactoryCalls).toStrictEqual([
      {
        apiKey: "google-key",
        name: "google-name",
      },
    ]);
  });

  it("builds openai-compatible models and derives a default name from the base url", () => {
    const options = buildLLMOptions({
      llm: {
        apiKey: "compat-key",
        baseURL: "https://compat.example/v1",
        model: "compat-model",
        provider: "openai-compatible",
      },
    });

    expect(options.model).toStrictEqual({
      model: "compat-model",
      provider: "openai-compatible",
    });
    expect(llmMockState.openAICompatibleFactoryCalls).toStrictEqual([
      {
        apiKey: "compat-key",
        baseURL: "https://compat.example/v1",
        name: "compat.example",
      },
    ]);
    expect(llmMockState.openAICompatibleModelCalls).toStrictEqual([
      "compat-model",
    ]);
  });

  it("falls back to a generic openai-compatible name for invalid urls", () => {
    buildLLMOptions({
      llm: {
        baseURL: "not a url",
        model: "compat-model",
        provider: "openai-compatible",
      },
    });

    expect(llmMockState.openAICompatibleFactoryCalls).toStrictEqual([
      {
        baseURL: "not a url",
        name: "openai-compatible",
      },
    ]);
  });

  it("rejects missing provider/model inputs and missing openai-compatible base urls", () => {
    expect(() => buildLLMOptions({})).toThrow(
      "Missing LLM configuration. Set --llm, `llm.provider` and `llm.model` in ~/.wikigraph/config.json, or the matching SPINEDIGEST_LLM_* environment variables.\nSee: wikigraph help config",
    );
    expect(() =>
      buildLLMOptions({
        llm: {
          model: "compat-model",
          provider: "openai-compatible",
        },
      }),
    ).toThrow(
      "openai-compatible requires llm.baseURL, baseURL in --llm JSON, or SPINEDIGEST_LLM_BASE_URL.\nSee: wikigraph help config",
    );
  });

  it("rejects custom base urls on the official openai provider", () => {
    expect(() =>
      buildLLMOptions({
        llm: {
          apiKey: "secret",
          baseURL: "https://api.example/v1",
          model: "gpt-test",
          provider: "openai",
        },
      }),
    ).toThrow(
      "openai does not accept llm.baseURL, baseURL in --llm JSON, or SPINEDIGEST_LLM_BASE_URL. Use openai-compatible for third-party OpenAI-style APIs.\nSee: wikigraph help config",
    );
  });
});
