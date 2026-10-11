import type { Entry } from "../platform/index.js";
import { createPortableHash as createHash } from "../../utils/crypto.js";

export function createArchiveKey(archive: Entry): string {
  return createHash("sha256").update(archive.identity).digest("hex");
}

export function formatErrorEvent(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return error;
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
