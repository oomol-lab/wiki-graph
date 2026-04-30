import { describe, expect, it, vi } from "vitest";

vi.mock("readline", () => ({
  clearLine: (stream: FakeTTYStream) => {
    stream.clearLine();
  },
  cursorTo: (stream: FakeTTYStream, column: number) => {
    stream.cursorTo(column);
  },
  moveCursor: (stream: FakeTTYStream, dx: number, dy: number) => {
    stream.moveCursor(dx, dy);
  },
}));

import { createCLIProgressRenderer } from "../../src/cli/progress.js";

describe("cli/progress", () => {
  it("renders stage totals and only keeps active serials visible", async () => {
    const stream = new FakeTTYStream();
    const renderer = createCLIProgressRenderer({
      enabled: true,
      stream: stream as unknown as NodeJS.WriteStream,
    });

    expect(renderer.onProgress).toBeTypeOf("function");

    if (renderer.onProgress === undefined) {
      throw new Error(
        "Progress callback should exist when renderer is enabled",
      );
    }

    await Promise.all([
      renderer.onProgress({
        available: true,
        serials: [
          {
            fragments: 3,
            id: 2,
            words: 1820,
          },
          {
            fragments: 2,
            id: 1,
            words: 882,
          },
        ],
        type: "serials-discovered",
      }),
      renderer.onProgress({
        completedWords: 0,
        totalWords: 2702,
        type: "digest-progress",
      }),
    ]);

    await Promise.all([
      renderer.onProgress({
        completedWords: 1576,
        completedFragments: 2,
        id: 2,
        type: "serial-progress",
      }),
      renderer.onProgress({
        completedWords: 793,
        completedFragments: 1,
        id: 1,
        type: "serial-progress",
      }),
    ]);

    await renderer.onProgress({
      completedWords: 882,
      completedFragments: 2,
      id: 1,
      type: "serial-progress",
    });
    await renderer.onProgress({
      completedWords: 882,
      totalWords: 2702,
      type: "digest-progress",
    });

    await renderer.stop();

    expect(stream.visibleLines()).toStrictEqual([
      "Serial  [###########.] 2,458 / 2,702 words",
      "Digest  [####........] 882 / 2,702 words",
      "------------------------",
      "#2        [##########..] 1,576 / 1,820 words (2/3 fragments)",
    ]);
  });

  it("preserves the terminal row above the progress block while lines shrink", async () => {
    const stream = new FakeTTYStream({
      lines: ["shell> "],
      row: 1,
    });
    const renderer = createCLIProgressRenderer({
      enabled: true,
      stream: stream as unknown as NodeJS.WriteStream,
    });

    if (renderer.onProgress === undefined) {
      throw new Error(
        "Progress callback should exist when renderer is enabled",
      );
    }

    await renderer.onProgress({
      available: true,
      serials: [
        {
          fragments: 2,
          id: 1,
          words: 10,
        },
        {
          fragments: 2,
          id: 2,
          words: 10,
        },
      ],
      type: "serials-discovered",
    });
    await renderer.onProgress({
      completedWords: 0,
      totalWords: 20,
      type: "digest-progress",
    });
    await renderer.onProgress({
      completedFragments: 1,
      completedWords: 5,
      id: 1,
      type: "serial-progress",
    });
    await renderer.onProgress({
      completedFragments: 2,
      completedWords: 10,
      id: 1,
      type: "serial-progress",
    });
    await renderer.onProgress({
      completedFragments: 1,
      completedWords: 5,
      id: 2,
      type: "serial-progress",
    });

    await renderer.stop();

    expect(stream.visibleLines()).toStrictEqual([
      "shell> ",
      "Serial  [#########...] 15 / 20 words",
      "Digest  [............] 0 / 20 words",
      "------------------------",
      "#2        [######......] 5 / 10 words (1/2 fragments)",
    ]);
  });
});

class FakeTTYStream {
  #column = 0;
  #lines: string[];
  #row: number;

  public constructor(input?: {
    readonly lines?: readonly string[];
    readonly row?: number;
  }) {
    this.#lines = [...(input?.lines ?? [""])];
    this.#row = input?.row ?? 0;
    this.#ensureLine(this.#row);
  }

  public clearLine(): void {
    this.#ensureLine(this.#row);
    this.#lines[this.#row] = "";
    this.#column = 0;
  }

  public cursorTo(column: number): void {
    this.#column = Math.max(0, column);
  }

  public moveCursor(dx: number, dy: number): void {
    this.#column = Math.max(0, this.#column + dx);
    this.#row = Math.max(0, this.#row + dy);
    this.#ensureLine(this.#row);
  }

  public visibleLines(): string[] {
    const lines = [...this.#lines];

    while (lines.length > 0 && lines.at(-1) === "") {
      lines.pop();
    }

    return lines;
  }

  public write(chunk: string | Uint8Array): boolean {
    const text = String(chunk);

    for (const character of text) {
      if (character === "\n") {
        this.#row += 1;
        this.#column = 0;
        this.#ensureLine(this.#row);
        continue;
      }

      this.#ensureLine(this.#row);

      const currentLine = this.#lines[this.#row] ?? "";
      const paddedLine =
        this.#column > currentLine.length
          ? currentLine.padEnd(this.#column, " ")
          : currentLine;

      this.#lines[this.#row] =
        paddedLine.slice(0, this.#column) +
        character +
        paddedLine.slice(this.#column + 1);

      this.#column += 1;
    }

    return true;
  }

  #ensureLine(index: number): void {
    while (this.#lines.length <= index) {
      this.#lines.push("");
    }
  }
}
