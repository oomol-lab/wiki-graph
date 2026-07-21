import { describe, expect, it } from "vitest";

import {
  inferCLIFormatFromPath,
  isTextCLIFormat,
  parseCLIFormat,
} from "../../packages/cli/src/support/index.js";

describe("cli/formats", () => {
  it("infers formats from file extensions", () => {
    expect(inferCLIFormatFromPath("book.epub")).toBe("epub");
    expect(inferCLIFormatFromPath("notes.md")).toBe("markdown");
    expect(inferCLIFormatFromPath("notes.markdown")).toBe("markdown");
    expect(inferCLIFormatFromPath("draft.wikg")).toBe("wikg");
    expect(inferCLIFormatFromPath("plain.txt")).toBe("txt");
    expect(inferCLIFormatFromPath("plain.unknown")).toBeUndefined();
  });

  it("detects text formats", () => {
    expect(isTextCLIFormat("markdown")).toBe(true);
    expect(isTextCLIFormat("txt")).toBe(true);
    expect(isTextCLIFormat("epub")).toBe(false);
  });

  it("parses and normalizes format flags", () => {
    expect(parseCLIFormat("  EPUB ", "--format")).toBe("epub");
    expect(() => parseCLIFormat("pdf", "--format")).toThrow(
      "Invalid --format: pdf. Expected one of wikg, epub, txt, markdown.",
    );
  });
});
