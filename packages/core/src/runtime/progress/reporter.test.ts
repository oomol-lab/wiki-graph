import { describe, expect, it, vi } from "vitest";

import { ProgressReporter } from "./index.js";

describe("progress/reporter", () => {
  it("does not fail the pipeline when the progress callback throws", async () => {
    const reporter = new ProgressReporter("digest-text-stream", () => {
      throw new Error("UI disconnected");
    });

    await expect(
      reporter.emit({
        completedWords: 0,
        totalWords: 12,
        type: "digest-progress",
      }),
    ).resolves.toBeUndefined();
  });

  it("delivers structured events to the callback", async () => {
    const callback = vi.fn();
    const reporter = new ProgressReporter("digest-text-stream", callback);

    await reporter.emit({
      available: true,
      serials: [
        {
          fragments: 4,
          id: 7,
          title: "Chapter 7",
          words: 1600,
        },
      ],
      type: "serials-discovered",
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      available: true,
      serials: [
        {
          fragments: 4,
          id: 7,
          title: "Chapter 7",
          words: 1600,
        },
      ],
      type: "serials-discovered",
    });
  });
});
