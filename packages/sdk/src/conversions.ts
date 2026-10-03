import { createHash } from "crypto";
import { createReadStream } from "fs";
import { rm } from "fs/promises";
import { basename } from "path";

import {
  WikiGraph,
  type ChapterStage,
  type WikiGraphArchive,
  type WikiGraphProgressCallback,
  type SourceArtifactInput,
} from "wiki-graph-core";

import { buildWikiGraphLLMOptions } from "./llm.js";
import { NodeDirectory, NodeFile } from "./node-platform.js";
import { loadWikiGraphRuntimeConfig } from "./runtime-config.js";
import type { WikiGraphJobRuntime } from "./jobs.js";
import { resolveWikiGraphRuntimePath } from "./runtime-path.js";

export type WikiGraphConversionFormat =
  | "epub"
  | "markdown"
  | "pcex"
  | "txt"
  | "wikg";
export type WikiGraphSourceFormat = Exclude<WikiGraphConversionFormat, "wikg">;

export type WikiGraphConversionInput =
  | {
      readonly format: Exclude<WikiGraphConversionFormat, "pcex">;
      readonly path: string;
    }
  | {
      readonly format: "pcex";
      readonly path: string;
      readonly sourcePdf: { readonly digest: string; readonly name?: string };
    }
  | {
      readonly format: Extract<WikiGraphSourceFormat, "markdown" | "txt">;
      readonly stream: AsyncIterable<string> | Iterable<string>;
    };

export interface WikiGraphConversionOptions {
  readonly digestDirectory?: string;
  readonly input: WikiGraphConversionInput;
  readonly llmJSON?: string;
  readonly onProgress?: WikiGraphProgressCallback;
  readonly onSourceImported?: () => void | Promise<void>;
  readonly output: {
    readonly format: WikiGraphConversionFormat;
    readonly path: string;
  };
  readonly prompt?: string;
  readonly targetStage?: ChapterStage;
  readonly verbose?: boolean;
}

export interface WikiGraphConversionResult {
  readonly chapterCount?: number;
  readonly inputFormat: WikiGraphConversionFormat;
  readonly outputFormat: WikiGraphConversionFormat;
  readonly outputPath: string;
  readonly sourceArtifact?: SourceArtifactInput;
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
    if (options.output.format === "pcex") {
      throw new Error("pcex is supported only as a conversion input.");
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
    let chapterCount: number | undefined;
    const write = async (archive: WikiGraphArchive): Promise<void> => {
      if (requiresDigest) await options.onSourceImported?.();
      if (typeof archive.readToc === "function") {
        const toc = await archive.readToc();
        chapterCount =
          toc === undefined ? undefined : countTocChapters(toc.items);
      }
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
      } else if (options.input.format === "pcex") {
        await app.digestPcexSession(
          {
            ...digestOptions,
            pdfDigest: options.input.sourcePdf.digest,
            ...(options.input.sourcePdf.name === undefined
              ? {}
              : { pdfName: options.input.sourcePdf.name }),
          },
          write,
        );
      } else if (options.input.format === "markdown") {
        await app.digestMarkdownSession(digestOptions, write);
      } else {
        await app.digestTxtSession(digestOptions, write);
      }
    }

    const sourceArtifact = await resolveSourceArtifact(options.input);
    return {
      ...(chapterCount === undefined ? {} : { chapterCount }),
      inputFormat: options.input.format,
      outputFormat: options.output.format,
      outputPath: options.output.path,
      ...(sourceArtifact === undefined ? {} : { sourceArtifact }),
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
  else if (format === "pcex") throw new Error("pcex output is not supported.");
  else await archive.exportText(file);
}

async function resolveSourceArtifact(
  input: WikiGraphConversionInput,
): Promise<SourceArtifactInput | undefined> {
  if (!("path" in input) || input.format === "wikg") return undefined;
  if (input.format === "pcex") {
    return {
      digest: input.sourcePdf.digest.trim().toLowerCase(),
      mediaType: "application/pdf",
      ...(input.sourcePdf.name === undefined
        ? {}
        : { name: input.sourcePdf.name }),
    };
  }
  if (input.format !== "epub") return undefined;
  const path = resolveWikiGraphRuntimePath(input.path);
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
    }
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  return {
    digest: hash.digest("hex"),
    mediaType: "application/epub+zip",
    name: basename(path),
  };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function countTocChapters(
  items: readonly {
    readonly children: readonly unknown[];
    readonly serialId?: number | undefined;
  }[],
): number {
  let count = 0;
  for (const item of items) {
    if (item.serialId !== undefined) count += 1;
    count += countTocChapters(
      item.children as readonly {
        readonly children: readonly unknown[];
        readonly serialId?: number | undefined;
      }[],
    );
  }
  return count;
}
