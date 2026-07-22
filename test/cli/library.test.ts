import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CLISupport from "../../packages/cli/src/support/index.js";
import type * as WikiGraphCore from "wiki-graph-core";

const libraryMockState = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
  putCalls: [] as unknown[],
  textWrites: [] as string[],
}));

vi.mock("wiki-graph-core", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphCore>();

  return {
    ...actual,
    putWikiGraphLibraryMetadata: vi.fn(
      (_target: unknown, key: string, value: unknown) => {
        libraryMockState.putCalls.push({ key, value });
        libraryMockState.metadata[key] = value;
        return Promise.resolve({ ...libraryMockState.metadata });
      },
    ),
  };
});

vi.mock("../../packages/cli/src/support/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CLISupport>();

  return {
    ...actual,
    writeTextToStdout: vi.fn((text: string) => {
      libraryMockState.textWrites.push(text);
      return Promise.resolve();
    }),
  };
});

import { parseCLIArguments } from "../../packages/cli/src/args/index.js";
import { runLibraryCommand } from "../../packages/cli/src/commands/index.js";

describe("cli/library args", () => {
  beforeEach(() => {
    libraryMockState.metadata = {};
    libraryMockState.putCalls.length = 0;
    libraryMockState.textWrites.length = 0;
  });

  it("parses library create, scope, remove, and metadata commands", () => {
    expect(
      parseCLIArguments([
        "wikg://lib",
        "create",
        "--path",
        "/tmp/research",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        json: true,
        path: "/tmp/research",
        target: { isDefault: true, kind: "scope" },
      },
      help: false,
      kind: "library",
    });

    expect(parseCLIArguments(["wikg://lib/abc123abc123.lib"])).toStrictEqual({
      args: {
        action: "list",
        json: undefined,
        target: { isDefault: false, kind: "scope", publicId: "abc123abc123" },
      },
      help: false,
      kind: "library",
    });

    expect(
      parseCLIArguments(["wikg://lib/abc123abc123.lib", "remove", "--json"]),
    ).toMatchObject({
      args: {
        action: "remove",
        json: true,
        target: { publicId: "abc123abc123" },
      },
      kind: "library",
    });

    expect(
      parseCLIArguments(["wikg://lib/meta", "put", "note", "Default"]),
    ).toMatchObject({
      args: {
        action: "put",
        inputValue: "Default",
        key: "note",
        target: { isDefault: true, kind: "metadata" },
      },
      help: false,
      kind: "library",
    });
  });

  it("parses library archive URI actions and rejects inspect", () => {
    expect(
      parseCLIArguments(["wikg://lib/abc123abc123", "remove", "--confirm"]),
    ).toMatchObject({
      args: {
        action: "remove",
        confirm: true,
        target: { archivePublicId: "abc123abc123", kind: "archive" },
      },
      kind: "library",
    });
    expect(parseCLIArguments(["wikg://lib/entity/Q23"])).toMatchObject({
      args: {
        action: "list",
        target: { kind: "scope", objectUri: "wikg://entity/Q23" },
      },
      kind: "library",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/abc123abc123.lib", "inspect"]),
    ).toThrow("does not support `inspect`");
  });

  it("routes library URI and predicate help through command pages", () => {
    const scopeHelp = parseCLIArguments(["wikg://lib", "--help"]);
    const createHelp = parseCLIArguments(["wikg://lib", "create", "--help"]);
    const putHelp = parseCLIArguments(["wikg://lib/meta", "put", "--help"]);

    expect(scopeHelp).toMatchObject({
      help: true,
      kind: "help",
    });
    if (!scopeHelp.help || !createHelp.help || !putHelp.help) {
      throw new Error("Expected help output.");
    }
    expect(scopeHelp.helpText).toContain("Library scope");
    expect(createHelp.helpText).toContain(
      "Create a non-default library registry",
    );
    expect(putHelp.helpText).toContain("Write one library metadata key");
    expect(() =>
      parseCLIArguments(["wikg://lib/abc123abc123.lib", "create", "--help"]),
    ).toThrow("Create libraries from wikg://lib.");
  });

  it("does not steal archive URIs below a lib path segment", () => {
    expect(parseCLIArguments(["wikg://lib/book.wikg"])).toMatchObject({
      args: {
        action: "list",
        archivePath: expect.stringContaining("lib/book.wikg") as string,
      },
      kind: "archive",
    });
  });

  it("keeps --json as output formatting for library metadata put", async () => {
    await runLibraryCommand({
      action: "put",
      inputValue: "42",
      json: true,
      key: "title",
      target: { isDefault: true, kind: "metadata" },
    });

    expect(libraryMockState.putCalls).toStrictEqual([
      { key: "title", value: "42" },
    ]);
    expect(JSON.parse(libraryMockState.textWrites[0]!)).toStrictEqual({
      title: "42",
    });
  });

  it("renders object metadata values as JSON in text output", async () => {
    await runLibraryCommand({
      action: "put",
      jsonInputValue: '{"nested":true}',
      key: "details",
      target: { isDefault: true, kind: "metadata" },
    });

    expect(libraryMockState.putCalls).toStrictEqual([
      { key: "details", value: { nested: true } },
    ]);
    expect(libraryMockState.textWrites).toStrictEqual([
      'details: {"nested":true}\n',
    ]);
  });
});
