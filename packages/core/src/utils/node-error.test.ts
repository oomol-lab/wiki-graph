import { describe, expect, it } from "vitest";

import { formatError, isNodeError } from "./node-error.js";

describe("utils/node-error", () => {
  it("detects Error instances only", () => {
    expect(isNodeError(new Error("boom"))).toBe(true);
    expect(isNodeError({ code: "ENOENT" })).toBe(false);
    expect(isNodeError("boom")).toBe(false);
  });

  it("formats missing files without exposing Node stack wording", () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory"),
      {
        code: "ENOENT",
        path: "/tmp/missing.wikg",
      },
    );

    expect(formatError(error)).toBe(
      "File not found: /tmp/missing.wikg (ENOENT)",
    );
  });

  it("formats permission errors with the affected path", () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
      path: "/tmp/private.wikg",
    });

    expect(formatError(error)).toBe(
      "Permission denied: /tmp/private.wikg (EACCES)",
    );
  });
});
