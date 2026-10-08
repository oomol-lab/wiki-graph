import {
  clearLocalConfigSection,
  deleteLocalConfigValue,
  maskLocalConfigSection,
  putLocalConfigValue,
  readLocalConfigSection,
  replaceLocalConfigSection,
  type LocalConfigObject,
  type LocalConfigSection,
} from "./local-config.js";
import type { WikiGraphJobRuntime } from "./jobs.js";
import { embedQueryText, readWikiGraphEmbeddingConfig } from "./embedding.js";
import { buildWikiGraphLLMOptions } from "./llm.js";
import {
  resolveWikispineConfig,
  type WikiGraphProvider,
} from "./runtime-config.js";
import { nodeWikispineCommandRunner } from "./wikispine.js";

export interface WikiGraphProviderTestResult {
  readonly durationMs: number;
  readonly model?: string;
  readonly provider?: string;
  readonly response?: string;
  readonly dimensions?: number;
  readonly tokens?: number;
  readonly endpoint?: string;
  readonly metadata?: {
    readonly format: string;
    readonly qid_count: number;
    readonly surface_count: number;
  };
}

export class WikiGraphConfigManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async get(
    section: LocalConfigSection,
    options: { readonly maskSecrets?: boolean } = {},
  ): Promise<LocalConfigObject> {
    const value = await this.#runtime.run(
      async () => await readLocalConfigSection(section),
    );
    return options.maskSecrets === true
      ? maskLocalConfigSection(section, value)
      : value;
  }

  public async replace(
    section: LocalConfigSection,
    value: LocalConfigObject,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await replaceLocalConfigSection(section, value),
    );
  }

  public async put(
    section: LocalConfigSection,
    key: string,
    value: unknown,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await putLocalConfigValue(section, key, value),
    );
  }

  public async delete(
    section: LocalConfigSection,
    key: string,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await deleteLocalConfigValue(section, key),
    );
  }

  public async clear(section: LocalConfigSection): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await clearLocalConfigSection(section),
    );
  }

  public async testLLM(): Promise<WikiGraphProviderTestResult> {
    return await this.#runtime.run(async () => {
      const startedAt = Date.now();
      const llm = await readLocalConfigSection("llm");
      const config = {
        ...(typeof llm.apiKey === "string" ? { apiKey: llm.apiKey } : {}),
        ...(typeof llm.baseURL === "string" ? { baseURL: llm.baseURL } : {}),
        ...(typeof llm.model === "string" ? { model: llm.model } : {}),
        ...(typeof llm.name === "string" ? { name: llm.name } : {}),
        ...(typeof llm.provider === "string"
          ? { provider: parseProvider(llm.provider) }
          : {}),
      };
      const options = buildWikiGraphLLMOptions({ llm: config });
      const result = streamText({
        maxRetries: 0,
        messages: [{ content: "Reply with exactly: ok", role: "user" }],
        model: options.model!,
        temperature: 0,
      });
      const chunks: string[] = [];
      for await (const chunk of result.textStream) chunks.push(chunk);
      return {
        durationMs: Date.now() - startedAt,
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(config.provider === undefined ? {} : { provider: config.provider }),
        response: chunks.join("").trim(),
      };
    });
  }

  public async testEmbedding(): Promise<WikiGraphProviderTestResult> {
    return await this.#runtime.run(async () => {
      const startedAt = Date.now();
      const result = await embedQueryText(
        "Wiki Graph embedding connectivity test.",
        await readWikiGraphEmbeddingConfig(),
      );
      return {
        dimensions: result.dimensions,
        durationMs: Date.now() - startedAt,
        model: result.model,
        provider: result.provider,
        ...(result.usage?.tokens === undefined
          ? {}
          : { tokens: result.usage.tokens }),
      };
    });
  }

  public async testWikispine(): Promise<WikiGraphProviderTestResult> {
    return await this.#runtime.run(async () => {
      const value = await readLocalConfigSection("wikispine");
      const resolved = resolveWikispineConfig(value);
      if (resolved === undefined) {
        throw new Error("WikiSpine provider is not configured.");
      }
      const result = await testWikispineRuntime({
        ...resolved,
        ...(resolved.provider === "cli"
          ? { commandRunner: nodeWikispineCommandRunner }
          : {}),
      });
      return {
        durationMs: result.durationMs,
        ...(resolved.provider === "fetch"
          ? { endpoint: resolved.endpoint }
          : {}),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
        provider: resolved.provider,
      };
    });
  }
}

function parseProvider(value: string): WikiGraphProvider {
  if (
    value === "anthropic" ||
    value === "google" ||
    value === "openai" ||
    value === "openai-compatible"
  ) {
    return value;
  }
  throw new Error(
    `Invalid llm.provider: ${value}. Expected anthropic, google, openai, or openai-compatible.`,
  );
}
import { streamText } from "ai";
import { testWikispineRuntime } from "wiki-graph-core";
