import { expect, it } from "vitest";
import { mapConcurrent } from "./executor.js";

it("preserves the first task failure when a pending producer read subsequently fails", async () => {
  const primary = new Error("first task failure");
  const secondary = new Error("later iterator failure");
  let failProducer!: () => void;
  const taskFailed = new Promise<void>((resolve) => {
    failProducer = resolve;
  });
  async function* input() {
    yield 1;
    await taskFailed;
    throw secondary;
  }
  const result = async () => {
    for await (const value of mapConcurrent(
      input(),
      (_, signal) => {
        signal.addEventListener("abort", failProducer, { once: true });
        return Promise.reject(primary);
      },
      { concurrency: 2 },
    ))
      void value;
  };
  await expect(result()).rejects.toBe(primary);
});

it("preserves the producer failure when sibling cancellation and cleanup also fail", async () => {
  const primary = new Error("producer failure");
  let reads = 0;
  const input: AsyncIterable<number> = {
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          ++reads === 1
            ? Promise.resolve({ value: 1, done: false })
            : Promise.reject(primary),
        return: () => Promise.reject(new Error("cleanup failure")),
      };
    },
  };
  const result = async () => {
    for await (const value of mapConcurrent(
      input,
      (_, signal) =>
        new Promise<number>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("sibling cancelled")),
            { once: true },
          );
        }),
      { concurrency: 2 },
    ))
      void value;
  };
  await expect(result()).rejects.toBe(primary);
});
