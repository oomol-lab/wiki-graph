import { describe, expect, it } from "vitest";

import {
  createWikiGraphCLI,
  runWikiGraphCLICaptured,
} from "../../packages/cli/src/index.js";

describe("cli/sdk-runner", () => {
  it("captures stdout and stderr without spawning a process", async () => {
    const result = await runWikiGraphCLICaptured({
      argv: ["--version"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(result.stderr).toBe("");
  });

  it("supports reusable defaults with per-run argv overrides", async () => {
    const cli = createWikiGraphCLI({
      argv: ["--help"],
      stdinIsTTY: true,
    });

    const helpResult = await cli.runCaptured();
    const versionResult = await cli.runCaptured(["--version"]);

    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain("Wiki Graph CLI");
    expect(helpResult.stderr).toBe("");
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(versionResult.stderr).toBe("");
  });

  it("preserves CLI JSON error output", async () => {
    const result = await runWikiGraphCLICaptured({
      argv: ["unknown-command", "--json"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: {
        type: "error",
      },
    });
  });
});
