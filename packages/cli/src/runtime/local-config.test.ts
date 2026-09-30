import { describe, expect, it } from "vitest";

import {
  maskLocalConfigSection,
  normalizeLocalConfigKey,
  parseLocalConfigSection,
  validateLocalConfigSection,
} from "./local-config.js";

describe("runtime/local config", () => {
  it("accepts the legacy singular embedding section as an alias", () => {
    expect(parseLocalConfigSection("embedding")).toBe("embeddings");
  });

  it("validates embeddings config", () => {
    expect(
      validateLocalConfigSection("embeddings", {
        apiKey: " sk-test ",
        baseURL: " https://api.example.com/v1 ",
        dimensions: "1536",
        model: " text-embedding-3-small ",
        provider: "openai-compatible",
      }),
    ).toStrictEqual({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      dimensions: 1536,
      model: "text-embedding-3-small",
      provider: "openai-compatible",
    });

    expect(() =>
      validateLocalConfigSection("embeddings", {
        provider: "anthropic",
      }),
    ).toThrow("Unknown embeddings.provider");
    expect(() =>
      validateLocalConfigSection("embeddings", {
        dimensions: 0,
      }),
    ).toThrow("embeddings.dimensions must be a positive integer");
  });

  it("normalizes and masks embeddings config secrets", () => {
    expect(normalizeLocalConfigKey("embeddings", "api-key")).toBe("apiKey");
    expect(normalizeLocalConfigKey("embeddings", "base-url")).toBe("baseURL");
    expect(
      maskLocalConfigSection("embeddings", {
        apiKey: "sk-test",
        model: "text-embedding-3-small",
      }),
    ).toStrictEqual({
      apiKey: "****",
      model: "text-embedding-3-small",
    });
  });
});
