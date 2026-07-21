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

import { buildLLMOptions } from "../../packages/cli/src/runtime/llm.js";

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

  it("builds openai llm options with configured request concurrency", () => {
    const options = buildLLMOptions({
      concurrent: {
        request: 3,
      },
      llm: {
        apiKey: "secret",
        model: "gpt-test",
        name: "custom-openai",
        provider: "openai",
      },
    });

    expect(options.concurrent).toBe(3);
    expect(readModelId(options.model)).toBe("gpt-test");
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

    expect(readModelId(anthropic.model)).toBe("claude-test");
    expect(readModelId(google.model)).toBe("gemini-test");
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

    expect(readModelId(options.model)).toBe("compat-model");
  });

  it("falls back to a generic openai-compatible name for invalid urls", () => {
    const options = buildLLMOptions({
      llm: {
        baseURL: "not a url",
        model: "compat-model",
        provider: "openai-compatible",
      },
    });

    expect(readModelId(options.model)).toBe("compat-model");
  });

  it("rejects missing provider/model inputs and missing openai-compatible base urls", () => {
    expect(() => buildLLMOptions({})).toThrow(
      "Missing LLM configuration. Set --llm for one run, or configure `wikg://local/config/llm` with provider and model.\nSee: wg help config",
    );
    expect(() =>
      buildLLMOptions({
        llm: {
          model: "compat-model",
          provider: "openai-compatible",
        },
      }),
    ).toThrow(
      "openai-compatible requires llm.baseURL or baseURL in --llm JSON.\nSee: wg help config",
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
      "openai does not accept llm.baseURL or baseURL in --llm JSON. Use openai-compatible for third-party OpenAI-style APIs.\nSee: wg help config",
    );
  });
});

function readModelId(model: unknown): string | undefined {
  if (typeof model !== "object" || model === null || !("modelId" in model)) {
    return;
  }

  const modelId = (model as { readonly modelId?: unknown }).modelId;

  return typeof modelId === "string" ? modelId : undefined;
}
