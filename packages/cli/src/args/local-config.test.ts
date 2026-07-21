import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";

describe("cli/args/local config", () => {
  it("parses local config URI commands", () => {
    expect(parseCLIArguments(["wikg://local/config/llm"])).toStrictEqual({
      args: {
        action: "get",
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/llm",
        "put",
        "provider",
        "openai-compatible",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        inputValue: "openai-compatible",
        key: "provider",
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/llm",
        "put",
        "apiKey",
        "--secret",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        key: "apiKey",
        secret: true,
        section: "llm",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/concurrent",
        "set",
        "--json",
        '{"job":2,"request":4}',
      ]),
    ).toStrictEqual({
      args: {
        action: "set",
        json: true,
        jsonInputValue: '{"job":2,"request":4}',
        section: "concurrent",
      },
      help: false,
      kind: "local-config",
    });
    expect(
      parseCLIArguments([
        "wikg://local/config/wikispine",
        "put",
        "provider",
        "fetch",
      ]),
    ).toStrictEqual({
      args: {
        action: "put",
        inputValue: "fetch",
        key: "provider",
        section: "wikispine",
      },
      help: false,
      kind: "local-config",
    });
    expect(() => parseCLIArguments(["wikg://local/config"])).toThrow(
      "Expected a local config section URI",
    );
    expect(() => parseCLIArguments(["wikg://local/config/llm", "get"])).toThrow(
      "This command form is not available.",
    );
  });
});
