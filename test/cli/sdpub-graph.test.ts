import { beforeEach, describe, expect, it, vi } from "vitest";

const graphMockState = vi.hoisted(() => ({
  editableCalls: [] as string[],
  evidence: [
    {
      sentenceId: [2, 0, 1],
      text: "Source sentence one.",
    },
    {
      sentenceId: [2, 0, 2],
      text: "Source sentence two.",
    },
  ],
  neighbors: [
    {
      direction: "incoming",
      edge: {
        fromId: 7,
        toId: 9,
        weight: 0.4,
      },
      node: {
        content: "Earlier context",
        id: 7,
        label: "Earlier",
        sentenceIds: [[2, 0, 0]],
        weight: 0.3,
        wordsCount: 2,
      },
    },
    {
      direction: "outgoing",
      edge: {
        fromId: 9,
        toId: 11,
        weight: 0.6,
      },
      node: {
        content: "Later context",
        id: 11,
        label: "Later",
        sentenceIds: [[2, 0, 3]],
        weight: 0.5,
        wordsCount: 2,
      },
    },
  ],
  node: {
    content: "Central graph node content",
    id: 9,
    importance: "important",
    label: "Central",
    retention: "focused",
    sentenceIds: [
      [2, 0, 1],
      [2, 0, 2],
    ],
    weight: 0.9,
    wordsCount: 4,
  },
  nodes: [
    {
      content: "Central graph node content",
      id: 9,
      importance: "important",
      label: "Central",
      retention: "focused",
      sentenceIds: [
        [2, 0, 1],
        [2, 0, 2],
      ],
      weight: 0.9,
      wordsCount: 4,
    },
    {
      content: "Earlier context",
      id: 7,
      label: "Earlier",
      sentenceIds: [[2, 0, 0]],
      weight: 0.3,
      wordsCount: 2,
    },
  ],
  path: [] as unknown[],
  searchHits: [] as unknown[],
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
      graphMockState.editableCalls.push(this.#path);
      return await operation({});
    }
  },
}));

vi.mock("../../src/facade/index.js", () => ({
  findGraphPath: vi.fn(() => Promise.resolve(graphMockState.path)),
  getGraphEvidence: vi.fn(() => Promise.resolve(graphMockState.evidence)),
  getGraphNode: vi.fn(() => Promise.resolve(graphMockState.node)),
  getGraphStatus: vi.fn(() =>
    Promise.resolve({
      chapterId: 2,
      edgeCount: 2,
      graphReady: true,
      nodeCount: 3,
    }),
  ),
  listGraphNeighbors: vi.fn(() => Promise.resolve(graphMockState.neighbors)),
  listGraphNodes: vi.fn(() => Promise.resolve(graphMockState.nodes)),
  searchGraphNodes: vi.fn(() => Promise.resolve(graphMockState.searchHits)),
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    graphMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

import { runSdpubGraphCommand } from "../../src/cli/sdpub-graph.js";

describe("cli/sdpub-graph", () => {
  beforeEach(() => {
    graphMockState.editableCalls.length = 0;
    graphMockState.path = [
      {
        node: graphMockState.nodes[0],
      },
      {
        edge: {
          fromId: 9,
          toId: 11,
          weight: 0.6,
        },
        node: {
          content: "Later context",
          id: 11,
          label: "Later",
          sentenceIds: [[2, 0, 3]],
          weight: 0.5,
          wordsCount: 2,
        },
      },
    ];
    graphMockState.searchHits = [
      {
        matchedFields: ["label", "content"],
        node: graphMockState.node,
      },
    ];
    graphMockState.textWrites.length = 0;
  });

  it("prints graph status", async () => {
    await runSdpubGraphCommand({
      action: "status",
      chapterId: 2,
      path: "/tmp/book.sdpub",
    });

    expect(graphMockState.editableCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(graphMockState.textWrites).toStrictEqual([
      "Chapter: 2\nGraph: yes\nNodes: 3\nEdges: 2\n",
    ]);
  });

  it("prints graph log lines with a limit", async () => {
    await runSdpubGraphCommand({
      action: "log",
      chapterId: 2,
      limit: 1,
      path: "/tmp/book.sdpub",
    });

    expect(graphMockState.textWrites).toStrictEqual([
      "[9] 0.900 Central - Central graph node content\n",
    ]);
  });

  it("shows one graph node", async () => {
    await runSdpubGraphCommand({
      action: "show",
      chapterId: 2,
      nodeId: 9,
      path: "/tmp/book.sdpub",
    });

    expect(graphMockState.textWrites[0]).toContain("[9] Central\n");
    expect(graphMockState.textWrites[0]).toContain(
      "Content:\nCentral graph node content\n",
    );
    expect(graphMockState.textWrites[0]).toContain("<- [7] 0.400 Earlier");
    expect(graphMockState.textWrites[0]).toContain(
      "2.0.1 Source sentence one.",
    );
  });

  it("prints grep hits", async () => {
    await runSdpubGraphCommand({
      action: "grep",
      chapterId: 2,
      path: "/tmp/book.sdpub",
      pattern: "central",
    });

    expect(graphMockState.textWrites).toStrictEqual([
      "[9] 0.900 Central - Central graph node content matches:label,content\n",
    ]);
  });

  it("prints neighbors", async () => {
    await runSdpubGraphCommand({
      action: "neighbors",
      chapterId: 2,
      nodeId: 9,
      path: "/tmp/book.sdpub",
    });

    expect(graphMockState.textWrites).toStrictEqual([
      "  <- [7] 0.400 Earlier\n  -> [11] 0.600 Later\n",
    ]);
  });

  it("prints node evidence", async () => {
    await runSdpubGraphCommand({
      action: "blame",
      chapterId: 2,
      nodeId: 9,
      path: "/tmp/book.sdpub",
    });

    expect(graphMockState.textWrites).toStrictEqual([
      "2.0.1 Source sentence one.\n2.0.2 Source sentence two.\n",
    ]);
  });

  it("prints a directed path", async () => {
    await runSdpubGraphCommand({
      action: "path",
      chapterId: 2,
      fromNodeId: 9,
      path: "/tmp/book.sdpub",
      toNodeId: 11,
    });

    expect(graphMockState.textWrites).toStrictEqual([
      "[9] 0.900 Central - Central graph node content\n  -> 0.600\n[11] 0.500 Later - Later context\n",
    ]);
  });
});
