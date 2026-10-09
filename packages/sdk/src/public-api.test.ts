import { describe, expect, it } from "vitest";

import {
  formatSourceArtifactUri,
  formatSourceLocatorFragment,
  parseSourceLocatorFragment,
  type Directory,
  type File,
  type ParsedSourceLocatorFragment,
  type SearchIndexQueryMode,
  type WikiGraphPlatform,
  type WikiGraphStorage,
} from "./index.js";

describe("SDK public API", () => {
  it("exports source locator helpers without a Core import", () => {
    const fragment = formatSourceLocatorFragment("application/pdf", {
      bbox: [0.1, 0.2, 0.3, 0.4],
      pageIndex: 2,
    });
    const parsed: ParsedSourceLocatorFragment =
      parseSourceLocatorFragment(fragment);

    expect(parsed).toMatchObject({ mediaType: "application/pdf" });
    expect(formatSourceArtifactUri("a".repeat(64), fragment)).toContain(
      fragment,
    );
  });

  it("keeps host and query types available from the SDK boundary", () => {
    const mode: SearchIndexQueryMode = "hybrid";
    type HostTypes = [Directory, File, WikiGraphPlatform, WikiGraphStorage];
    const resources: HostTypes | undefined = undefined;

    expect(mode).toBe("hybrid");
    expect(resources).toBeUndefined();
  });
});
