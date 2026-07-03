import { describe, expect, it } from "vitest";

import { mergeMaskedSecretsForSet } from "../../src/cli/local-config.js";
import {
  maskLocalConfigSection,
  normalizeLocalConfigKey,
  validateLocalConfigSection,
} from "../../src/cli/local-config-store.js";

describe("cli/local-config", () => {
  it("normalizes llm kebab-case keys", () => {
    expect(normalizeLocalConfigKey("llm", "api-key")).toBe("apiKey");
    expect(normalizeLocalConfigKey("llm", "base-url")).toBe("baseURL");
    expect(normalizeLocalConfigKey("llm", "model")).toBe("model");
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
    ).toThrow("apiKey is sensitive and cannot be set from JSON.");
  });
});
