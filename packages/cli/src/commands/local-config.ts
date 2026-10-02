import { Writable } from "stream";
import { createInterface } from "readline/promises";

import type { CLILocalConfigArguments } from "../args/index.js";
import { getWikiGraphSDK, setCLIExitCode } from "../runtime/context.js";
import { writeTextToStderr, writeTextToStdout } from "../support/index.js";
import { formatCLIJSON } from "../support/index.js";
import {
  maskLocalConfigSection,
  type LocalConfigObject,
} from "../runtime/local-config.js";

export async function runLocalConfigCommand(
  args: CLILocalConfigArguments,
): Promise<void> {
  const config = getWikiGraphSDK().config;
  switch (args.action) {
    case "get":
      await writeConfigObject(args.section, await config.get(args.section));
      return;
    case "set":
      await writeConfigObject(
        args.section,
        await config.replace(
          args.section,
          mergeMaskedSecretsForSet(
            args.section,
            readJSONInput(args),
            await config.get(args.section),
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
        await config.put(args.section, key, value),
      );
      return;
    }
    case "delete":
      await writeConfigObject(
        args.section,
        await config.delete(args.section, requireConfigKey(args.key)),
      );
      return;
    case "clear":
      await writeConfigObject(args.section, await config.clear(args.section));
      return;
    case "test":
      await runConfigTest(args);
      return;
  }
}

async function runConfigTest(args: CLILocalConfigArguments): Promise<void> {
  switch (args.section) {
    case "llm":
      await runLLMConfigTest(args);
      return;
    case "wikispine":
      await runWikispineConfigTest(args);
      return;
    case "embeddings":
      await runEmbeddingConfigTest(args);
      return;
    default:
      throw new Error(
        "Only wikg://local/config/llm, wikg://local/config/embeddings, and wikg://local/config/wikispine support test.",
      );
  }
}

async function runEmbeddingConfigTest(
  args: CLILocalConfigArguments,
): Promise<void> {
  const startedAt = Date.now();
  const embedding = await getWikiGraphSDK().config.get("embeddings");

  try {
    const result = await getWikiGraphSDK().config.testEmbedding();
    const output = {
      dimensions: result.dimensions!,
      durationMs: result.durationMs,
      model: result.model,
      ok: true,
      provider: result.provider!,
      ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      return;
    }

    await writeTextToStdout(
      [
        "Embedding connection ok.",
        `Provider: ${output.provider}`,
        `Model: ${output.model}`,
        `Dimensions: ${output.dimensions}`,
        "",
      ].join("\n"),
    );
  } catch (error) {
    const output = {
      durationMs: Date.now() - startedAt,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      model: embedding.model,
      ok: false,
      provider: embedding.provider,
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      setCLIExitCode(1);
      return;
    }

    throw error;
  }
}

async function runLLMConfigTest(args: CLILocalConfigArguments): Promise<void> {
  if (args.section !== "llm") {
    throw new Error("Only wikg://local/config/llm supports test.");
  }

  const startedAt = Date.now();
  const llm = await getWikiGraphSDK().config.get("llm");

  try {
    const result = await getWikiGraphSDK().config.testLLM();
    const output = {
      durationMs: result.durationMs,
      model: result.model,
      ok: true,
      provider: result.provider,
      response: result.response,
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
      setCLIExitCode(1);
      return;
    }

    throw error;
  }
}

async function runWikispineConfigTest(
  args: CLILocalConfigArguments,
): Promise<void> {
  const startedAt = Date.now();
  const wikispine = await getWikiGraphSDK().config.get("wikispine");

  try {
    const result = await getWikiGraphSDK().config.testWikispine();
    const output = {
      durationMs: result.durationMs,
      ...(result.endpoint === undefined ? {} : { endpoint: result.endpoint }),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      ok: true,
      provider: result.provider,
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      return;
    }

    await writeTextToStdout(
      [
        "WikiSpine connection ok.",
        `Provider: ${output.provider}`,
        ...(output.endpoint === undefined
          ? []
          : [`Endpoint: ${output.endpoint}`]),
        ...(output.metadata === undefined
          ? []
          : [
              `Runtime: ${output.metadata.format}`,
              `Surfaces: ${output.metadata.surface_count}`,
              `QIDs: ${output.metadata.qid_count}`,
            ]),
        "",
      ].join("\n"),
    );
  } catch (error) {
    const output = {
      durationMs: Date.now() - startedAt,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
      provider:
        typeof wikispine.provider === "string" ? wikispine.provider : undefined,
    };

    if (args.json === true) {
      await writeTextToStdout(formatCLIJSON(output));
      setCLIExitCode(1);
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
  if (section === "wikimedia" || section === "wikispine") {
    return mergeMaskedSecret(section, input, current, "token");
  }
  if (
    (section !== "llm" && section !== "embeddings") ||
    input.apiKey === undefined
  ) {
    return input;
  }
  if (typeof input.apiKey === "string" && /^\*+$/u.test(input.apiKey)) {
    return current.apiKey === undefined
      ? omitKey(input, "apiKey")
      : { ...input, apiKey: current.apiKey };
  }

  throw new Error(
    `apiKey is sensitive and cannot be set from JSON. Use \`wg wikg://local/config/${section} put apiKey --secret\`.`,
  );
}

function mergeMaskedSecret(
  section: "wikimedia" | "wikispine",
  input: LocalConfigObject,
  current: LocalConfigObject,
  key: "token",
): LocalConfigObject {
  const value = input[key];
  if (value === undefined) return input;
  if (typeof value === "string" && /^\*+$/u.test(value)) {
    return current[key] === undefined
      ? omitKey(input, key)
      : { ...input, [key]: current[key] };
  }
  throw new Error(
    `${key} is sensitive and cannot be set from JSON. Use \`wg wikg://local/config/${section} put ${key} --secret\`.`,
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
