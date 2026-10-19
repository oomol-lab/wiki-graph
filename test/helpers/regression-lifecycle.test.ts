import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { describe, expect, it } from "vitest";
import { RegressionLifecycle } from "./regression-lifecycle.js";

describe("regression lifecycle", () => {
  it("cancels and joins timed-out setup before closing the SDK and deleting its root", async () => {
    const scope = new RegressionLifecycle();
    const root = await mkdtemp(join(tmpdir(), "wg-lifecycle-"));
    const order: string[] = [];
    scope.defer(async () => {
      expect(await readFile(join(root, "finally.txt"), "utf8")).toBe("closed");
      order.push("remove");
      await rm(root, { recursive: true });
    });
    scope.defer(() => {
      order.push("sdk-close");
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setup = scope.track(async () => {
      await gate;
      expect(scope.signal.aborted).toBe(true);
      await writeFile(join(root, "finally.txt"), "closed");
      order.push("setup-finally");
    });
    const cleanup = scope.dispose();
    expect(order).toEqual([]);
    expect(scope.signal.aborted).toBe(true);
    release();
    await Promise.all([setup, cleanup]);
    expect(order).toEqual(["setup-finally", "sdk-close", "remove"]);
    await scope.dispose();
    expect(order).toHaveLength(3);
    expect(() => scope.track(() => Promise.resolve())).toThrow();
  });

  it("retains an in-flight operation failure and all cleanup failures", async () => {
    const scope = new RegressionLifecycle();
    const original = new Error("original operation failed");
    const cleanup = new Error("cleanup failed");
    const order: number[] = [];
    scope.defer(() => {
      order.push(1);
    });
    scope.defer(() => {
      throw cleanup;
    });
    scope.defer(() => {
      order.push(2);
    });
    const operation = scope.track(() => Promise.reject(original));
    const disposing = scope.dispose();
    await expect(operation).rejects.toBe(original);
    await expect(disposing).rejects.toMatchObject({
      errors: [original, cleanup],
    });
    expect(order).toEqual([2, 1]);
  });

  it("joins the real body after a Vitest timeout before deleting its files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wg-runner-timeout-"));
    try {
      const child = spawn(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--config",
          "test/fixtures/regression-lifecycle/vitest.config.ts",
        ],
        {
          env: { ...process.env, WIKIGRAPH_LIFECYCLE_ROOT: root },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10_000,
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      const exit = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(exit, output).toBe(1);
      expect(output).toContain("Test timed out");
      expect(output).not.toContain("ENOENT");
      expect(output).not.toContain("ENOTEMPTY");
      expect(
        JSON.parse(await readFile(join(root, "order.json"), "utf8")),
      ).toEqual(["late-write", "finally", "close", "remove"]);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
