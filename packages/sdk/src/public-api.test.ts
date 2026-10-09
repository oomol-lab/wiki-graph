import { describe, expect, it } from "vitest";

import {
  createNodeWikiGraphPlatform,
  createNodeWikiGraphStorage,
  formatSourceArtifactUri,
  formatSourceLocatorFragment,
  isWikiGraphJobUri,
  isWikiGraphUri,
  parseSourceLocatorFragment,
  requireArchiveUri,
  requireLocatedObjectOrArchiveUri,
  requireLocatedObjectUri,
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

  it("exposes Node host factories from the SDK boundary", () => {
    const platform = createNodeWikiGraphPlatform({
      lifecycle: {
        instanceId: "host:test",
        isInstanceAlive: () => Promise.resolve(true),
      },
    });
    const storage = createNodeWikiGraphStorage({
      documentStoreRoot: "/tmp/documents",
      libraryRoot: "/tmp/home",
    });

    expect(platform.lifecycle.instanceId).toBe("host:test");
    expect(storage.library.identity).not.toBe(storage.documentStore.identity);
  });

  it("exports URI guards without a Core import", () => {
    expect(isWikiGraphUri("wikg://chapter/1")).toBe(true);
    expect(isWikiGraphJobUri("wikg://local/job/example")).toBe(true);
    expect(requireArchiveUri("wikg:///tmp/example.wikg")).toBe(
      "/tmp/example.wikg",
    );
    expect(
      requireLocatedObjectOrArchiveUri("wikg:///tmp/example.wikg/chapter/1"),
    ).toStrictEqual({
      archivePath: "/tmp/example.wikg",
      objectUri: "wikg://chapter/1",
    });
    expect(
      requireLocatedObjectUri("wikg:///tmp/example.wikg/chapter/1"),
    ).toStrictEqual({
      archivePath: "/tmp/example.wikg",
      objectUri: "wikg://chapter/1",
    });
  });
});
