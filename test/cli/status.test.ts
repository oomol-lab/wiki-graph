import { mkdir, writeFile } from "fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusMockState = vi.hoisted(() => ({
  stdoutTexts: [] as string[],
}));

vi.mock("../../src/cli/io.js", () => ({
  writeTextToStdout: vi.fn((text: string) => {
    statusMockState.stdoutTexts.push(text);
  }),
}));

import { runStatusCommand } from "../../src/cli/status.js";
import { withTempDir } from "../helpers/temp.js";

describe("cli/status", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    statusMockState.stdoutTexts.length = 0;

    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  });

  it("prints {} when the config file does not exist", async () => {
    await withTempDir("wikigraph-status-", async (path) => {
      process.env.WIKIGRAPH_CONFIG = `${path}/missing.json`;
      await runStatusCommand({});

      expect(statusMockState.stdoutTexts).toStrictEqual(["{}\n"]);
    });
  });

  it("prints masked config json when the config file is valid", async () => {
    await withTempDir("wikigraph-status-", async (path) => {
      const configPath = `${path}/nested/config.json`;

      await mkdir(`${path}/nested`, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            llm: {
              apiKey: "sk-test-secret-key",
              model: "gpt-4.1",
              provider: "openai",
            },
            paths: {
              cacheDir: "./cache",
            },
          },
          null,
          2,
        ),
      );
      process.env.WIKIGRAPH_CONFIG = configPath;

      await runStatusCommand({});

      expect(statusMockState.stdoutTexts).toStrictEqual([
        `{
  "configFilePath": "${configPath}",
  "llm": {
    "apiKey": "sk-t**********-key",
    "model": "gpt-4.1",
    "provider": "openai"
  },
  "paths": {
    "cacheDir": "${path}/nested/cache"
  }
}\n`,
      ]);
    });
  });

  it("masks short api keys without exposing the full secret", async () => {
    await withTempDir("wikigraph-status-", async (path) => {
      const configPath = `${path}/config.json`;

      await writeFile(
        configPath,
        JSON.stringify(
          {
            llm: {
              apiKey: "sk-x",
              model: "gpt-4.1",
              provider: "openai",
            },
          },
          null,
          2,
        ),
      );
      process.env.WIKIGRAPH_CONFIG = configPath;

      await runStatusCommand({});

      expect(statusMockState.stdoutTexts).toStrictEqual([
        `{
  "configFilePath": "${configPath}",
  "llm": {
    "apiKey": "sk-***",
    "model": "gpt-4.1",
    "provider": "openai"
  }
}\n`,
      ]);
    });
  });

  it("throws when the config file is invalid", async () => {
    await withTempDir("wikigraph-status-", async (path) => {
      const configPath = `${path}/broken.json`;

      await writeFile(configPath, "{not json", "utf8");
      process.env.WIKIGRAPH_CONFIG = configPath;

      await expect(runStatusCommand({})).rejects.toThrow(
        `Invalid CLI config JSON at ${configPath}:`,
      );
    });
  });

  it("prints masked merged config when inline llm json is provided", async () => {
    await withTempDir("wikigraph-status-", async (path) => {
      process.env.WIKIGRAPH_CONFIG = `${path}/missing.json`;

      await runStatusCommand({
        llmJSON: JSON.stringify({
          apiKey: "sk-inline-secret-key",
          baseUrl: "https://inline.example/v1",
          model: "inline-model",
        }),
      });

      expect(statusMockState.stdoutTexts).toStrictEqual([
        `{
  "llm": {
    "apiKey": "sk-i************-key",
    "baseURL": "https://inline.example/v1",
    "model": "inline-model",
    "provider": "openai-compatible"
  }
}\n`,
      ]);
    });
  });
});
