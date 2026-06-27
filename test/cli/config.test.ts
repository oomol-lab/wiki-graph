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
    await withTempDir("wikigraph-config-", async (path) => {
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
            queue: {
              concurrent: 1,
            },
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

      process.env.WIKIGRAPH_CONFIG = configPath;
      process.env.WIKIGRAPH_PROMPT = " Env prompt ";
      process.env.WIKIGRAPH_LLM_MODEL = "env-model";
      process.env.WIKIGRAPH_LLM_PROVIDER = "OPENAI-COMPATIBLE";
      process.env.WIKIGRAPH_LLM_BASE_URL = "https://env.example/v1";
      process.env.WIKIGRAPH_CACHE_DIR = "./env-cache";
      process.env.WIKIGRAPH_DEBUG_LOG_DIR = "./env-debug";
      process.env.WIKIGRAPH_REQUEST_CONCURRENT = "5";
      process.env.WIKIGRAPH_QUEUE_CONCURRENT = "3";
      process.env.WIKIGRAPH_REQUEST_RETRY_INTERVAL_SECONDS = "2.5";
      process.env.WIKIGRAPH_REQUEST_RETRY_TIMES = "4";
      process.env.WIKIGRAPH_REQUEST_STREAM = "true";
      process.env.WIKIGRAPH_REQUEST_TEMPERATURE = "[0.3,0.6]";
      process.env.WIKIGRAPH_REQUEST_TIMEOUT = "30000";
      process.env.WIKIGRAPH_REQUEST_TOP_P = "0.9";

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
        queue: {
          concurrent: 3,
        },
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
    await withTempDir("wikigraph-config-", async (path) => {
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

      process.env.WIKIGRAPH_CONFIG = configPath;

      await expect(loadCLIConfig()).resolves.toStrictEqual({
        configFilePath: configPath,
        paths: {
          cacheDir: `${path}/cache-store`,
          debugLogDir: `${path}/settings/debug-store`,
        },
      });
    });
  });

  it("lets inline llm json override env and file llm values", async () => {
    await withTempDir("wikigraph-config-", async (path) => {
      const configPath = `${path}/config.json`;

      await writeFile(
        configPath,
        JSON.stringify({
          llm: {
            apiKey: "file-key",
            baseURL: "https://file.example/v1",
            model: "file-model",
            provider: "openai",
          },
        }),
      );

      process.env.WIKIGRAPH_CONFIG = configPath;
      process.env.WIKIGRAPH_LLM_API_KEY = "env-key";
      process.env.WIKIGRAPH_LLM_BASE_URL = "https://env.example/v1";
      process.env.WIKIGRAPH_LLM_MODEL = "env-model";
      process.env.WIKIGRAPH_LLM_PROVIDER = "openai-compatible";

      await expect(
        loadCLIConfig({
          llmJSON: JSON.stringify({
            apiKey: "inline-key",
            baseUrl: "https://inline.example/v1",
            model: "inline-model",
          }),
        }),
      ).resolves.toStrictEqual({
        configFilePath: configPath,
        llm: {
          apiKey: "inline-key",
          baseURL: "https://inline.example/v1",
          model: "inline-model",
          provider: "openai-compatible",
        },
      });
    });
  });

  it("accepts nested inline llm json and chat completions urls", async () => {
    await withTempDir("wikigraph-config-", async (path) => {
      process.env.WIKIGRAPH_CONFIG = `${path}/missing.json`;

      await expect(
        loadCLIConfig({
          llmJSON: JSON.stringify({
            llm: {
              apiKey: "inline-key",
              chatCompletionsUrl: "https://inline.example/v1/chat/completions",
              model: "inline-model",
            },
          }),
        }),
      ).resolves.toStrictEqual({
        llm: {
          apiKey: "inline-key",
          baseURL: "https://inline.example/v1",
          model: "inline-model",
          provider: "openai-compatible",
        },
      });
    });
  });

  it("returns an empty config when no config file exists", async () => {
    await withTempDir("wikigraph-config-", async (path) => {
      process.env.WIKIGRAPH_CONFIG = `${path}/missing.json`;

      await expect(loadCLIConfig()).resolves.toStrictEqual({});
    });
  });

  it("rejects invalid config json and invalid env values", async () => {
    await withTempDir("wikigraph-config-", async (path) => {
      const configPath = `${path}/broken.json`;

      await writeFile(configPath, "{not json", "utf8");
      process.env.WIKIGRAPH_CONFIG = configPath;

      await expect(loadCLIConfig()).rejects.toThrow(
        `Invalid CLI config JSON at ${configPath}:`,
      );
      await expect(loadCLIConfig()).rejects.toThrow(
        "See: wikigraph help config-file",
      );
    });

    process.env.WIKIGRAPH_LLM_PROVIDER = "bad-provider";

    await expect(loadCLIConfig()).rejects.toThrow(
      "Invalid WIKIGRAPH_LLM_PROVIDER: bad-provider. Expected one of anthropic, google, openai, openai-compatible.\nSee: wikigraph help env",
    );

    delete process.env.WIKIGRAPH_LLM_PROVIDER;
    process.env.WIKIGRAPH_REQUEST_CONCURRENT = "1.5";

    await expect(loadCLIConfig()).rejects.toThrow(
      "WIKIGRAPH_REQUEST_CONCURRENT must be an integer.\nSee: wikigraph help env",
    );

    delete process.env.WIKIGRAPH_REQUEST_CONCURRENT;
    process.env.WIKIGRAPH_QUEUE_CONCURRENT = "0";

    await expect(loadCLIConfig()).rejects.toThrow(
      "WIKIGRAPH_QUEUE_CONCURRENT must be a positive number.\nSee: wikigraph help env",
    );

    delete process.env.WIKIGRAPH_QUEUE_CONCURRENT;
    process.env.WIKIGRAPH_REQUEST_TEMPERATURE = '[1,"bad"]';

    await expect(loadCLIConfig()).rejects.toThrow(
      "WIKIGRAPH_REQUEST_TEMPERATURE must be a number or JSON number array.\nSee: wikigraph help env",
    );

    delete process.env.WIKIGRAPH_REQUEST_TEMPERATURE;
    process.env.WIKIGRAPH_REQUEST_STREAM = "maybe";

    await expect(loadCLIConfig()).rejects.toThrow(
      "WIKIGRAPH_REQUEST_STREAM must be true/false or 1/0.\nSee: wikigraph help env",
    );

    delete process.env.WIKIGRAPH_REQUEST_STREAM;

    await expect(loadCLIConfig({ llmJSON: "{not json" })).rejects.toThrow(
      "Invalid --llm JSON:",
    );

    await expect(loadCLIConfig({ llmJSON: "{}" })).rejects.toThrow(
      "--llm must contain at least one supported LLM field.\nSee: wikigraph help config",
    );

    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          chatCompletionsUrl: "https://example.test/responses",
        }),
      }),
    ).rejects.toThrow(
      "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.\nSee: wikigraph help config",
    );

    await expect(
      loadCLIConfig({
        llmJSON: JSON.stringify({
          llm: {
            chatCompletionsUrl: "https://example.test/responses",
          },
        }),
      }),
    ).rejects.toThrow(
      "--llm chatCompletionsUrl must end with /chat/completions when baseURL is not provided.\nSee: wikigraph help config",
    );
  });
});
