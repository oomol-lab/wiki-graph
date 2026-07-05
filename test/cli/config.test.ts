import { beforeEach, describe, expect, it, vi } from "vitest";

const configMockState = vi.hoisted(() => ({
  sections: {
    concurrent: {} as Record<string, unknown>,
    llm: {} as Record<string, unknown>,
    wikispine: {} as Record<string, unknown>,
  },
}));

vi.mock("../../src/cli/local-config-store.js", () => ({
  readLocalConfigSection: vi.fn((section: "concurrent" | "llm" | "wikispine") =>
    Promise.resolve(configMockState.sections[section]),
  ),
}));

import { loadCLIConfig } from "../../src/cli/config.js";

describe("cli/config", () => {
  beforeEach(() => {
    configMockState.sections = {
      concurrent: {},
      llm: {},
      wikispine: {},
    };
  });

  it("loads llm, concurrent, and wikispine settings from local config sections", async () => {
    configMockState.sections = {
      concurrent: {
        job: 3,
        request: 6,
      },
      llm: {
        apiKey: "local-key",
        baseURL: "https://local.example/v1",
        model: "local-model",
        provider: "openai-compatible",
      },
      wikispine: {
        provider: "fetch",
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
        provider: "fetch",
      },
    });
  });

  it("lets inline llm json override local llm values", async () => {
    configMockState.sections = {
      concurrent: {},
      llm: {
        apiKey: "local-key",
        baseURL: "https://local.example/v1",
        model: "local-model",
        provider: "openai-compatible",
      },
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
      "--llm must contain at least one supported LLM field.\nSee: wikigraph help config",
    );

    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          chatCompletionsUrl: "https://example.test/responses",
        }),
      }),
    ).rejects.toThrow(
      "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.\nSee: wikigraph help config",
    );
  });
});
