import { Writable } from "stream";
import { createInterface } from "readline/promises";

import { generateText } from "ai";

import type { CLILocalConfigArguments } from "./args.js";
import type { CLIProvider } from "./config.js";
import { buildLLMOptions } from "./llm.js";
import { writeTextToStderr, writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";
import {
  clearLocalConfigSection,
  deleteLocalConfigValue,
  maskLocalConfigSection,
  putLocalConfigValue,
  readLocalConfigSection,
  replaceLocalConfigSection,
  type LocalConfigObject,
} from "./local-config-store.js";

export async function runLocalConfigCommand(
  args: CLILocalConfigArguments,
): Promise<void> {
  switch (args.action) {
    case "get":
      await writeConfigObject(
        args.section,
        await readLocalConfigSection(args.section),
      );
      return;
    case "set":
      await writeConfigObject(
        args.section,
        await replaceLocalConfigSection(
          args.section,
          mergeMaskedSecretsForSet(
            args.section,
            readJSONInput(args),
            await readLocalConfigSection(args.section),
          ),
        ),
      );
      return;
    case "put": {
      const key = requireConfigKey(args.key);
      const value =
        args.secret === true
          ? await readSecretValue(key)
          : await readPutValue(args);

      await writeConfigObject(
        args.section,
        await putLocalConfigValue(args.section, key, value),
      );
      return;
    }
    case "delete":
      await writeConfigObject(
        args.section,
        await deleteLocalConfigValue(args.section, requireConfigKey(args.key)),
      );
      return;
    case "clear":
      await writeConfigObject(
        args.section,
        await clearLocalConfigSection(args.section),
      );
      return;
    case "test":
      await runLLMConfigTest(args);
      return;
  }
}

async function runLLMConfigTest(args: CLILocalConfigArguments): Promise<void> {
  if (args.section !== "llm") {
    throw new Error("Only wikg://local/config/llm supports test.");
  }

  const startedAt = Date.now();
  const llm = await readLocalConfigSection("llm");

  try {
    const llmConfig = {
      ...(typeof llm.apiKey === "string" ? { apiKey: llm.apiKey } : {}),
      ...(typeof llm.baseURL === "string" ? { baseURL: llm.baseURL } : {}),
      ...(typeof llm.model === "string" ? { model: llm.model } : {}),
      ...(typeof llm.name === "string" ? { name: llm.name } : {}),
      ...(typeof llm.provider === "string"
        ? { provider: parseLLMProvider(llm.provider) }
        : {}),
    };
    const options = buildLLMOptions({
      llm: llmConfig,
    });
    const result = await generateText({
      maxRetries: 0,
      messages: [
        {
          content: "Reply with exactly: ok",
          role: "user",
        },
      ],
      model: options.model,
      temperature: 0,
    });
    const output = {
      durationMs: Date.now() - startedAt,
      model: llmConfig.model,
      ok: true,
      provider: llmConfig.provider,
      response: result.text.trim(),
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      return;
    }

    await writeTextToStdout(
      [
        "LLM connection ok.",
        `Provider: ${output.provider}`,
        `Model: ${output.model}`,
        `Response: ${output.response}`,
        "",
      ].join("\n"),
    );
  } catch (error) {
    const output = {
      durationMs: Date.now() - startedAt,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      model: typeof llm.model === "string" ? llm.model : undefined,
      ok: false,
      provider: typeof llm.provider === "string" ? llm.provider : undefined,
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

async function writeConfigObject(
  section: CLILocalConfigArguments["section"],
  value: LocalConfigObject,
): Promise<void> {
  await writeTextToStdout(
    formatCLIJSON(maskLocalConfigSection(section, value)),
  );
}

function readPutValue(args: CLILocalConfigArguments): unknown {
  if (args.inputValue !== undefined && args.jsonInputValue !== undefined) {
    throw new Error(
      "Choose only one input source: positional value or --json value.",
    );
  }
  if (args.jsonInputValue !== undefined) {
    return parseJSONInput(args.jsonInputValue);
  }
  if (args.inputValue !== undefined) {
    return args.inputValue;
  }

  throw new Error("Missing config value.");
}

function readJSONInput(args: CLILocalConfigArguments): LocalConfigObject {
  const raw = args.jsonInputValue ?? args.inputValue;

  if (raw === undefined) {
    throw new Error("Config set requires a JSON object.");
  }

  const parsed = parseJSONInput(raw);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config set requires a JSON object.");
  }

  return parsed as LocalConfigObject;
}

export function mergeMaskedSecretsForSet(
  section: CLILocalConfigArguments["section"],
  input: LocalConfigObject,
  current: LocalConfigObject,
): LocalConfigObject {
  if (section !== "llm" || input.apiKey === undefined) {
    return input;
  }
  if (typeof input.apiKey === "string" && /^\*+$/u.test(input.apiKey)) {
    return current.apiKey === undefined
      ? omitKey(input, "apiKey")
      : { ...input, apiKey: current.apiKey };
  }

  throw new Error(
    "apiKey is sensitive and cannot be set from JSON. Use `wikigraph wikg://local/config/llm put apiKey --secret`.",
  );
}

function omitKey(input: LocalConfigObject, key: string): LocalConfigObject {
  const { [key]: _removed, ...rest } = input;

  return rest;
}

function parseJSONInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireConfigKey(key: string | undefined): string {
  const normalized = key?.trim() ?? "";

  if (normalized === "") {
    throw new Error("Missing config key.");
  }

  return normalized;
}

function parseLLMProvider(value: string): CLIProvider {
  switch (value) {
    case "anthropic":
    case "google":
    case "openai":
    case "openai-compatible":
      return value;
    default:
      throw new Error(
        `Invalid llm.provider: ${value}. Expected anthropic, google, openai, or openai-compatible.`,
      );
  }
}

async function readSecretValue(key: string): Promise<string> {
  if (process.stdin.isTTY !== true) {
    throw new Error(`${key} requires an interactive terminal.`);
  }

  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output: mutedOutput,
    terminal: true,
  });

  try {
    await writeTextToStderr(`${key}: `);
    const value = await readline.question("");
    await writeTextToStderr("\n");
    if (value.trim() === "") {
      throw new Error(`${key} cannot be empty.`);
    }

    return value.trim();
  } finally {
    readline.close();
  }
}
