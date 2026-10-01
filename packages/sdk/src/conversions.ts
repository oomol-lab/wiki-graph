import { rm } from "fs/promises";

import {
  WikiGraph,
  type ChapterStage,
  type WikiGraphArchive,
  type WikiGraphProgressCallback,
} from "wiki-graph-core";

import { buildWikiGraphLLMOptions } from "./llm.js";
import { NodeDirectory, NodeFile } from "./node-platform.js";
import { loadWikiGraphRuntimeConfig } from "./runtime-config.js";
import type { WikiGraphJobRuntime } from "./jobs.js";
import { resolveWikiGraphRuntimePath } from "./runtime-path.js";

export type WikiGraphConversionFormat = "epub" | "markdown" | "txt" | "wikg";
export type WikiGraphSourceFormat = Exclude<WikiGraphConversionFormat, "wikg">;

export type WikiGraphConversionInput =
  | { readonly format: WikiGraphConversionFormat; readonly path: string }
  | {
      readonly format: Extract<WikiGraphSourceFormat, "markdown" | "txt">;
      readonly stream: AsyncIterable<string> | Iterable<string>;
    };

export interface WikiGraphConversionOptions {
  readonly digestDirectory?: string;
  readonly input: WikiGraphConversionInput;
  readonly llmJSON?: string;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly output: {
    readonly format: WikiGraphConversionFormat;
    readonly path: string;
  };
  readonly prompt?: string;
  readonly targetStage?: ChapterStage;
  readonly verbose?: boolean;
}

export interface WikiGraphConversionResult {
  readonly inputFormat: WikiGraphConversionFormat;
  readonly outputFormat: WikiGraphConversionFormat;
  readonly outputPath: string;
}

export class WikiGraphConversionManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async convert(
    options: WikiGraphConversionOptions,
  ): Promise<WikiGraphConversionResult> {
    return await this.#runtime.run(async () => await this.#convert(options));
  }

  async #convert(
    options: WikiGraphConversionOptions,
  ): Promise<WikiGraphConversionResult> {
    const targetStage = options.targetStage ?? "summarized";
    if (options.targetStage !== undefined && options.output.format !== "wikg") {
      throw new Error("targetStage is only supported for wikg output.");
    }
    if (options.targetStage !== undefined && options.input.format === "wikg") {
      throw new Error(
        "targetStage is only supported when creating a wikg archive.",
      );
    }

    const requiresDigest = options.input.format !== "wikg";
    const requiresLLM =
      requiresDigest && targetStage !== "planned" && targetStage !== "sourced";
    const config = await loadWikiGraphRuntimeConfig({
      ...(options.llmJSON === undefined ? {} : { llmJSON: options.llmJSON }),
    });
    const app = new WikiGraph({
      ...(options.verbose === true ? { verbose: true } : {}),
      ...(requiresLLM ? { llm: buildWikiGraphLLMOptions(config) } : {}),
    });
    const documentDirectory = await prepareDigestDirectory(
      options.digestDirectory,
      requiresDigest,
    );
    const write = async (archive: WikiGraphArchive): Promise<void> => {
      await writeArchive(archive, options.output.path, options.output.format);
    };

    if (options.input.format === "wikg") {
      if (!("path" in options.input)) {
        throw new Error("wikg input requires a file path.");
      }
      await app.openSession(
        new NodeFile(resolveWikiGraphRuntimePath(options.input.path)),
        write,
      );
    } else if ("stream" in options.input) {
      await app.digestTextStreamSession(
        {
          ...(documentDirectory === undefined ? {} : { documentDirectory }),
          ...(options.onProgress === undefined
            ? {}
            : { onProgress: options.onProgress }),
          sourceFormat: options.input.format,
          stream: options.input.stream,
          ...((options.prompt ?? config.prompt) === undefined
            ? {}
            : { extractionPrompt: options.prompt ?? config.prompt }),
          targetStage,
        },
        write,
      );
    } else {
      const digestOptions = {
        ...(documentDirectory === undefined ? {} : { documentDirectory }),
        file: new NodeFile(resolveWikiGraphRuntimePath(options.input.path)),
        ...(options.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
        ...((options.prompt ?? config.prompt) === undefined
          ? {}
          : { extractionPrompt: options.prompt ?? config.prompt }),
        targetStage,
      };
      if (options.input.format === "epub") {
        await app.digestEpubSession(digestOptions, write);
      } else if (options.input.format === "markdown") {
        await app.digestMarkdownSession(digestOptions, write);
      } else {
        await app.digestTxtSession(digestOptions, write);
      }
    }

    return {
      inputFormat: options.input.format,
      outputFormat: options.output.format,
      outputPath: options.output.path,
    };
  }
}

async function prepareDigestDirectory(
  path: string | undefined,
  required: boolean,
): Promise<NodeDirectory | undefined> {
  const normalized = path?.trim();
  if (!required || normalized === undefined || normalized === "")
    return undefined;
  const resolved = resolveWikiGraphRuntimePath(normalized);
  await rm(resolved, { force: true, recursive: true });
  return new NodeDirectory(resolved);
}

async function writeArchive(
  archive: WikiGraphArchive,
  path: string,
  format: WikiGraphConversionFormat,
): Promise<void> {
  const file = new NodeFile(resolveWikiGraphRuntimePath(path));
  if (format === "epub") await archive.exportEpub(file);
  else if (format === "wikg") await archive.saveAs(file);
  else await archive.exportText(file);
}
