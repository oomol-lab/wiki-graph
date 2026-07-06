import { describe, expect, it } from "vitest";

import {
  formatShellArgument,
  formatShellCommand,
} from "../../src/cli/shell.js";

describe("cli/shell", () => {
  it("keeps simple shell arguments readable", () => {
    expect(formatShellArgument("wikg:///tmp/book.wikg/index")).toBe(
      "wikg:///tmp/book.wikg/index",
    );
  });

  it("quotes shell arguments with whitespace or shell metacharacters", () => {
    expect(formatShellArgument("wikg:///tmp/My Book.wikg/index")).toBe(
      "'wikg:///tmp/My Book.wikg/index'",
    );
    expect(formatShellArgument("wikg:///tmp/it's.wikg/index")).toBe(
      "'wikg:///tmp/it'\\''s.wikg/index'",
    );
    expect(formatShellArgument("")).toBe("''");
  });

  it("formats copyable shell commands", () => {
    expect(
      formatShellCommand([
        "wikigraph",
        "wikg:///tmp/My Book.wikg/index",
        "enable",
      ]),
    ).toBe("wikigraph 'wikg:///tmp/My Book.wikg/index' enable");
  });
});
