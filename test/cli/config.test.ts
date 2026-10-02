import { beforeEach, describe, expect, it, vi } from "vitest";

const configMockState = vi.hoisted(() => ({
  sections: {
    concurrent: {} as Record<string, unknown>,
    embeddings: {} as Record<string, unknown>,
    llm: {} as Record<string, unknown>,
    wikimedia: {} as Record<string, unknown>,
    wikispine: {} as Record<string, unknown>,
  },
}));

vi.mock("../../packages/sdk/src/local-config.js", () => ({
  readLocalConfigSection: vi.fn(
    (
      section: "concurrent" | "embeddings" | "llm" | "wikimedia" | "wikispine",
    ) => Promise.resolve(configMockState.sections[section]),
  ),
}));

import { loadCLIConfig } from "../../packages/cli/src/runtime/config.js";

describe("cli/config", () => {
  beforeEach(() => {
    configMockState.sections = {
      concurrent: {},
      embeddings: {},
      llm: {},
      wikimedia: {},
      wikispine: {},
    };
  });

  it("loads llm, concurrent, and wikispine settings from local config sections", async () => {
    configMockState.sections = {
      concurrent: {
        job: 3,
        request: 6,
      },
      embeddings: {},
      llm: {
        apiKey: "local-key",
        baseURL: "https://local.example/v1",
        model: "local-model",
        provider: "openai-compatible",
      },
      wikimedia: {},
      wikispine: {
        provider: "fetch",
        token: "local-wikispine-key",
      },
    };

    await expect(loadCLIConfig()).resolves.toStrictEqual({
      llm: {
        apiKey: "local-key",
        baseURL: "https://local.example/v1",
        model: "local-model",
        provider: "openai-compatible",
      },
      concurrent: {
        job: 3,
        request: 6,
      },
      wikispine: {
        endpoint: "https://api.pdfcraft.ai/v1/wikispine",
        provider: "fetch",
        token: "local-wikispine-key",
      },
    });
  });

  it("lets inline llm json override local llm values", async () => {
    configMockState.sections = {
      concurrent: {},
      embeddings: {},
      llm: {
        apiKey: "local-key",
        baseURL: "https://local.example/v1",
        model: "local-model",
        provider: "openai-compatible",
      },
      wikimedia: {},
      wikispine: {},
    };

    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          apiKey: "inline-key",
          baseUrl: "https://inline.example/v1",
          model: "inline-model",
        }),
      }),
    ).resolves.toStrictEqual({
      llm: {
        apiKey: "inline-key",
        baseURL: "https://inline.example/v1",
        model: "inline-model",
        provider: "openai-compatible",
      },
    });
  });

  it("accepts nested inline llm json and chat completions urls", async () => {
    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          llm: {
            apiKey: "inline-key",
            chatCompletionsUrl: "https://inline.example/v1/chat/completions",
            model: "inline-model",
          },
        }),
      }),
    ).resolves.toStrictEqual({
      llm: {
        apiKey: "inline-key",
        baseURL: "https://inline.example/v1",
        model: "inline-model",
        provider: "openai-compatible",
      },
    });
  });

  it("returns an empty config when local sections are empty", async () => {
    await expect(loadCLIConfig()).resolves.toStrictEqual({});
  });

  it("rejects invalid inline llm json", async () => {
    await expect(loadCLIConfig({ llmJSON: "{not json" })).rejects.toThrow(
      "Invalid --llm JSON:",
    );

    await expect(loadCLIConfig({ llmJSON: "{}" })).rejects.toThrow(
      "--llm must contain at least one supported LLM field.\nSee: wg help config",
    );

    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          chatCompletionsUrl: "https://example.test/responses",
        }),
      }),
    ).rejects.toThrow(
      "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.\nSee: wg help config",
    );
  });
});
