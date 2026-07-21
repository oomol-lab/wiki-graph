import { createHash, randomUUID } from "crypto";
import { stat } from "fs/promises";
import { resolve } from "path";

import { isNodeError } from "../../../utils/node-error.js";

export function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

export async function createArchiveSignature(
  archivePath: string,
): Promise<string> {
  const stats = await stat(archivePath);

  return `${stats.size}:${stats.mtimeMs}`;
}

export function createOwnerId(): string {
  return `${process.pid}-${randomUUID()}`;
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
