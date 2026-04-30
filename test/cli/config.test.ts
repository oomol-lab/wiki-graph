import { mkdir, writeFile } from "fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCLIConfig } from "../../src/cli/config.js";
import { withTempDir } from "../helpers/temp.js";

describe("cli/config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
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

  it("loads file config and lets env vars override it", async () => {
    await withTempDir("spinedigest-config-", async (path) => {
      const configPath = `${path}/nested/config.json`;

      await mkdir(`${path}/nested`, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            llm: {
              apiKey: "file-key",
              baseURL: "https://file.example/v1",
              model: "file-model",
              provider: "openai",
            },
            paths: {
              cacheDir: "./cache",
              debugLogDir: "./debug",
            },
            prompt: "File prompt",
            request: {
              concurrent: 2,
              retryIntervalSeconds: 1.5,
              retryTimes: 3,
              stream: false,
              temperature: [0.2, 0.4],
              timeout: 12000,
              topP: 0.8,
            },
          },
          null,
          2,
        ),
      );

      process.env.SPINEDIGEST_CONFIG = configPath;
      process.env.SPINEDIGEST_PROMPT = " Env prompt ";
      process.env.SPINEDIGEST_LLM_MODEL = "env-model";
      process.env.SPINEDIGEST_LLM_PROVIDER = "OPENAI-COMPATIBLE";
      process.env.SPINEDIGEST_LLM_BASE_URL = "https://env.example/v1";
      process.env.SPINEDIGEST_CACHE_DIR = "./env-cache";
      process.env.SPINEDIGEST_DEBUG_LOG_DIR = "./env-debug";
      process.env.SPINEDIGEST_REQUEST_CONCURRENT = "5";
      process.env.SPINEDIGEST_REQUEST_RETRY_INTERVAL_SECONDS = "2.5";
      process.env.SPINEDIGEST_REQUEST_RETRY_TIMES = "4";
      process.env.SPINEDIGEST_REQUEST_STREAM = "true";
      process.env.SPINEDIGEST_REQUEST_TEMPERATURE = "[0.3,0.6]";
      process.env.SPINEDIGEST_REQUEST_TIMEOUT = "30000";
      process.env.SPINEDIGEST_REQUEST_TOP_P = "0.9";

      await expect(loadCLIConfig()).resolves.toStrictEqual({
        configFilePath: configPath,
        llm: {
          apiKey: "file-key",
          baseURL: "https://env.example/v1",
          model: "env-model",
          provider: "openai-compatible",
        },
        paths: {
          cacheDir: `${process.cwd()}/env-cache`,
          debugLogDir: `${process.cwd()}/env-debug`,
        },
        prompt: "Env prompt",
        request: {
          concurrent: 5,
          retryIntervalSeconds: 2.5,
          retryTimes: 4,
          stream: true,
          temperature: [0.3, 0.6],
          timeout: 30000,
          topP: 0.9,
        },
      });
    });
  });

  it("resolves relative config paths from the config file directory", async () => {
    await withTempDir("spinedigest-config-", async (path) => {
      const configPath = `${path}/settings/config.json`;

      await mkdir(`${path}/settings`, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({
          paths: {
            cacheDir: "../cache-store",
            debugLogDir: "./debug-store",
          },
        }),
      );

      process.env.SPINEDIGEST_CONFIG = configPath;

      await expect(loadCLIConfig()).resolves.toStrictEqual({
        configFilePath: configPath,
        paths: {
          cacheDir: `${path}/cache-store`,
          debugLogDir: `${path}/settings/debug-store`,
        },
      });
    });
  });

  it("returns an empty config when no config file exists", async () => {
    await withTempDir("spinedigest-config-", async (path) => {
      process.env.SPINEDIGEST_CONFIG = `${path}/missing.json`;

      await expect(loadCLIConfig()).resolves.toStrictEqual({});
    });
  });

  it("rejects invalid config json and invalid env values", async () => {
    await withTempDir("spinedigest-config-", async (path) => {
      const configPath = `${path}/broken.json`;

      await writeFile(configPath, "{not json", "utf8");
      process.env.SPINEDIGEST_CONFIG = configPath;

      await expect(loadCLIConfig()).rejects.toThrow(
        `Invalid CLI config JSON at ${configPath}:`,
      );
      await expect(loadCLIConfig()).rejects.toThrow(
        "See: spinedigest help config-file",
      );
    });

    process.env.SPINEDIGEST_LLM_PROVIDER = "bad-provider";

    await expect(loadCLIConfig()).rejects.toThrow(
      "Invalid SPINEDIGEST_LLM_PROVIDER: bad-provider. Expected one of anthropic, google, openai, openai-compatible.\nSee: spinedigest help env",
    );

    delete process.env.SPINEDIGEST_LLM_PROVIDER;
    process.env.SPINEDIGEST_REQUEST_CONCURRENT = "1.5";

    await expect(loadCLIConfig()).rejects.toThrow(
      "SPINEDIGEST_REQUEST_CONCURRENT must be an integer.\nSee: spinedigest help env",
    );

    delete process.env.SPINEDIGEST_REQUEST_CONCURRENT;
    process.env.SPINEDIGEST_REQUEST_TEMPERATURE = '[1,"bad"]';

    await expect(loadCLIConfig()).rejects.toThrow(
      "SPINEDIGEST_REQUEST_TEMPERATURE must be a number or JSON number array.\nSee: spinedigest help env",
    );

    delete process.env.SPINEDIGEST_REQUEST_TEMPERATURE;
    process.env.SPINEDIGEST_REQUEST_STREAM = "maybe";

    await expect(loadCLIConfig()).rejects.toThrow(
      "SPINEDIGEST_REQUEST_STREAM must be true/false or 1/0.\nSee: spinedigest help env",
    );
  });
});
