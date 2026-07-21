import { describe, expect, it } from "vitest";

import { formatCLIJSON } from "../../packages/cli/src/support/index.js";

describe("cli/json", () => {
  it("preserves JSON.stringify omission semantics while ordering keys", () => {
    expect(
      formatCLIJSON({
        b: undefined,
        a: "visible",
        c: [undefined, "item"],
      }),
    ).toBe(
      [
        "{",
        '  "a": "visible",',
        '  "c": [',
        "    null,",
        '    "item"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});
