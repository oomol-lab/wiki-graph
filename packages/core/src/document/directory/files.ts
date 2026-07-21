import { join } from "path";

import { isNodeError } from "../../utils/node-error.js";
import type { DirectoryDocumentContext } from "./context.js";
import type { DocumentFileStore } from "./types.js";

export async function readJsonFile<T>(input: {
  readonly fileStore: DocumentFileStore;
  readonly parse: (value: unknown) => T;
  readonly path: string;
}): Promise<T | undefined> {
  const content = await readOptionalTextFile(input.fileStore, input.path);

  if (content === undefined) {
    return undefined;
  }

  return input.parse(JSON.parse(content));
}

export async function readOptionalFile(
  fileStore: DocumentFileStore,
  path: string,
): Promise<Uint8Array | undefined> {
  return await fileStore.readFile(path);
}

export async function writeJsonFile(input: {
  readonly context: DirectoryDocumentContext | undefined;
  readonly fileStore: DocumentFileStore;
  readonly options?: { readonly overwrite?: boolean };
  readonly path: string;
  readonly value: unknown;
}): Promise<void> {
  await writeFile({
    context: input.context,
    content: `${JSON.stringify(input.value, null, 2)}\n`,
    fileStore: input.fileStore,
    options: input.options ?? {},
    path: input.path,
  });
}

export async function writeNewFile(input: {
  readonly content: string | Uint8Array;
  readonly context: DirectoryDocumentContext | undefined;
  readonly fileStore: DocumentFileStore;
  readonly path: string;
}): Promise<void> {
  await writeFile({
    context: input.context,
    content: input.content,
    fileStore: input.fileStore,
    options: { overwrite: false },
    path: input.path,
  });
}

export function getCoverDataPath(documentPath: string): string {
  return join(getCoverDirectoryPath(documentPath), "data.bin");
}

export function getCoverDirectoryPath(documentPath: string): string {
  return join(documentPath, "cover");
}

export function getCoverInfoPath(documentPath: string): string {
  return join(getCoverDirectoryPath(documentPath), "info.json");
}

export function getTocPath(documentPath: string): string {
  return join(documentPath, "toc.json");
}

async function readOptionalTextFile(
  fileStore: DocumentFileStore,
  path: string,
): Promise<string | undefined> {
  const content = await fileStore.readFile(path);

  return content === undefined
    ? undefined
    : Buffer.from(content).toString("utf8");
}

async function writeFile(input: {
  readonly content: string | Uint8Array;
  readonly context: DirectoryDocumentContext | undefined;
  readonly fileStore: DocumentFileStore;
  readonly options: { readonly overwrite?: boolean };
  readonly path: string;
}): Promise<void> {
  try {
    await input.fileStore.writeFile(input.path, input.content, input.options);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(`File already exists: ${input.path}`);
    }

    throw error;
  }

  if (input.options.overwrite !== true) {
    input.context?.registerCreatedFile(input.path);
  }
}
