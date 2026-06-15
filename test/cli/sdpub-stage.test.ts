import { beforeEach, describe, expect, it, vi } from "vitest";

const stageMockState = vi.hoisted(() => ({
  advancedCalls: [] as unknown[],
  editableCalls: [] as string[],
  listEntries: [
    {
      chapterId: 1,
      childCount: 0,
      depth: 0,
      fragmentCount: 0,
      stage: "summarized",
      title: "Done",
      tocPath: ["Done"],
    },
    {
      chapterId: 2,
      childCount: 0,
      depth: 0,
      fragmentCount: 2,
      stage: "sourced",
      title: "Todo",
      tocPath: ["Todo"],
    },
  ],
  loadConfigCalls: [] as unknown[],
  textWrites: [] as string[],
}));

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async openEditableSession(
      operation: (document: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      stageMockState.editableCalls.push(this.#path);
      return await operation({});
    }
  },
}));

vi.mock("../../src/facade/index.js", () => ({
  advanceChapterStages: vi.fn((_document: unknown, options: unknown) => {
    stageMockState.advancedCalls.push(options);
    return Promise.resolve({
      advanced: [stageMockState.listEntries[1]],
      pending: [],
      skipped: [],
    });
  }),
  listChapters: vi.fn(() => Promise.resolve(stageMockState.listEntries)),
}));

vi.mock("../../src/cli/config.js", () => ({
  loadCLIConfig: vi.fn((options?: unknown) => {
    stageMockState.loadConfigCalls.push(options);
    return Promise.resolve({
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      prompt: "Config prompt",
    });
  }),
}));

vi.mock("../../src/cli/llm.js", () => ({
  buildLLMOptions: vi.fn(() => ({
    model: {},
  })),
}));

vi.mock("../../src/common/data-dir.js", () => ({
  resolveDataDirPath: vi.fn(() => "/tmp/data"),
}));

vi.mock("../../src/llm/index.js", () => ({
  LLM: class {
    public constructor(_options: unknown) {}
  },
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    stageMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

import { runSdpubStageCommand } from "../../src/cli/sdpub-stage.js";

describe("cli/sdpub-stage", () => {
  beforeEach(() => {
    stageMockState.advancedCalls.length = 0;
    stageMockState.editableCalls.length = 0;
    stageMockState.loadConfigCalls.length = 0;
    stageMockState.textWrites.length = 0;
  });

  it("prints pending chapters", async () => {
    await runSdpubStageCommand({
      action: "pending",
      path: "/tmp/book.sdpub",
    });

    expect(stageMockState.editableCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(stageMockState.textWrites).toStrictEqual(["[2] sourced    Todo\n"]);
  });

  it("advances to summarized by default", async () => {
    await runSdpubStageCommand({
      action: "advance",
      chapterId: 2,
      path: "/tmp/book.sdpub",
      prompt: "CLI prompt",
    });

    expect(stageMockState.advancedCalls).toHaveLength(1);
    expect(stageMockState.advancedCalls[0]).toMatchObject({
      chapterId: 2,
      extractionPrompt: "CLI prompt",
      targetStage: "summarized",
    });
    expect(stageMockState.textWrites).toStrictEqual([
      "Advanced: 1\nPending: 0\nSkipped: 0\n",
    ]);
  });

  it("accepts advancing to planned as a no-op without loading config", async () => {
    await runSdpubStageCommand({
      action: "advance",
      path: "/tmp/book.sdpub",
      targetStage: "planned",
    });

    expect(stageMockState.loadConfigCalls).toHaveLength(0);
    expect(stageMockState.advancedCalls).toHaveLength(0);
    expect(stageMockState.textWrites).toStrictEqual([
      "Advanced: 0\nPending: 0\nSkipped: 0\n",
    ]);
  });
});
