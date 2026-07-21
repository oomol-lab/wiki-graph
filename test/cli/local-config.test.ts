import { describe, expect, it } from "vitest";

import { mergeMaskedSecretsForSet } from "../../packages/cli/src/cli/commands/local-config.js";
import {
  maskLocalConfigSection,
  normalizeLocalConfigKey,
  validateLocalConfigSection,
} from "../../packages/cli/src/cli/local-config-store.js";

describe("cli/local-config", () => {
  it("normalizes llm kebab-case keys", () => {
    expect(normalizeLocalConfigKey("llm", "api-key")).toBe("apiKey");
    expect(normalizeLocalConfigKey("llm", "base-url")).toBe("baseURL");
    expect(normalizeLocalConfigKey("llm", "model")).toBe("model");
  });

  it("normalizes wikispine kebab-case keys", () => {
    expect(normalizeLocalConfigKey("wikispine", "provider")).toBe("provider");
  });

  it("validates concurrent values as positive integers", () => {
    expect(
      validateLocalConfigSection("concurrent", {
        job: "2",
        request: 4,
      }),
    ).toStrictEqual({
      job: 2,
      request: 4,
    });
    expect(() => validateLocalConfigSection("concurrent", { job: 0 })).toThrow(
      "concurrent.job must be a positive integer.",
    );
    expect(() =>
      validateLocalConfigSection("concurrent", { queue: 2 }),
    ).toThrow("Unknown concurrent config key: queue");
  });

  it("masks llm apiKey when presenting config", () => {
    expect(
      maskLocalConfigSection("llm", {
        apiKey: "sk-real",
        model: "gpt-test",
      }),
    ).toStrictEqual({
      apiKey: "****",
      model: "gpt-test",
    });
  });

  it("validates llm provider values at write time", () => {
    expect(
      validateLocalConfigSection("llm", {
        model: "gpt-test",
        provider: "openai-compatible",
      }),
    ).toStrictEqual({
      model: "gpt-test",
      provider: "openai-compatible",
    });
    expect(() =>
      validateLocalConfigSection("llm", {
        model: "gpt-test",
        provider: "unknown",
      }),
    ).toThrow("Unknown llm.provider: unknown");
  });

  it("validates wikispine provider values at write time", () => {
    expect(
      validateLocalConfigSection("wikispine", {
        provider: "fetch",
      }),
    ).toStrictEqual({
      provider: "fetch",
    });
    expect(
      validateLocalConfigSection("wikispine", {
        provider: "cli",
      }),
    ).toStrictEqual({
      provider: "cli",
    });
    expect(() =>
      validateLocalConfigSection("wikispine", { provider: "unknown" }),
    ).toThrow("Unknown wikispine.provider: unknown");
    expect(() =>
      validateLocalConfigSection("wikispine", { endpoint: "not a url" }),
    ).toThrow("Unknown wikispine config key: endpoint");
  });

  it("preserves masked apiKey during llm set --json", () => {
    expect(
      mergeMaskedSecretsForSet(
        "llm",
        {
          apiKey: "****",
          model: "new-model",
          provider: "openai",
        },
        {
          apiKey: "sk-existing",
          model: "old-model",
        },
      ),
    ).toStrictEqual({
      apiKey: "sk-existing",
      model: "new-model",
      provider: "openai",
    });
  });

  it("drops masked apiKey during llm set --json when no secret exists", () => {
    expect(
      mergeMaskedSecretsForSet(
        "llm",
        {
          apiKey: "****",
          model: "new-model",
        },
        {},
      ),
    ).toStrictEqual({
      model: "new-model",
    });
  });

  it("rejects real apiKey during llm set --json", () => {
    expect(() =>
      mergeMaskedSecretsForSet(
        "llm",
        {
          apiKey: "sk-real",
          model: "new-model",
        },
        {},
      ),
    ).toThrow(
      "apiKey is sensitive and cannot be set from JSON. Use `wg wikg://local/config/llm put apiKey --secret`.",
    );
  });
});
