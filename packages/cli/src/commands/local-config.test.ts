import { describe, expect, it } from "vitest";

import { mergeMaskedSecretsForSet } from "./local-config.js";

describe("commands/local-config", () => {
  it("preserves masked embedding api keys on section set", () => {
    expect(
      mergeMaskedSecretsForSet(
        "embeddings",
        {
          apiKey: "****",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        { apiKey: "sk-existing" },
      ),
    ).toStrictEqual({
      apiKey: "sk-existing",
      model: "text-embedding-3-small",
      provider: "openai",
    });
  });
});
